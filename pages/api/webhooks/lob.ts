/**
 * Lob Webhook Handler
 *
 * Handles delivery tracking events from Lob for mailed letters.
 * Updates letter status and notifies users of delivery milestones.
 *
 * Events we track:
 * - letter.in_transit: Letter is in transit
 * - letter.processed_for_delivery: Letter is out for delivery
 * - letter.re-routed: Letter was re-routed
 * - letter.returned_to_sender: Letter was returned
 * - letter.delivered: Letter was delivered (if tracking available)
 *
 * @see https://docs.lob.com/webhooks
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface LobWebhookEvent {
  id: string;
  event_type: {
    id: string;
    enabled_for_test: boolean;
  };
  date_created: string;
  object: string;
  body: {
    id: string; // Letter ID (ltr_xxx)
    description?: string;
    metadata?: {
      ticket_id?: string;
      letter_id?: string;
      user_id?: string;
    };
    to?: {
      name: string;
      address_line1: string;
      address_city: string;
      address_state: string;
      address_zip: string;
    };
    from?: {
      name: string;
      address_line1: string;
      address_city: string;
      address_state: string;
      address_zip: string;
    };
    tracking_number?: string;
    tracking_events?: Array<{
      type: string;
      name: string;
      details?: string;
      location?: string;
      time: string;
    }>;
    expected_delivery_date?: string;
    date_created?: string;
    date_modified?: string;
    url?: string;
    // Return info for returned letters
    return_envelope?: boolean;
    return_address?: {
      name: string;
      address_line1: string;
      address_city: string;
      address_state: string;
      address_zip: string;
    };
  };
}

/**
 * Read raw request body when bodyParser is disabled.
 * Required for HMAC signature verification (must use original bytes).
 */
async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Verify Lob webhook signature
 * Lob uses a simple signature header for verification
 */
function verifyLobSignature(payload: string, signature: string | undefined): boolean {
  const webhookSecret = process.env.LOB_WEBHOOK_SECRET;

  // If no webhook secret configured, fail closed — reject all webhooks
  if (!webhookSecret) {
    console.error('LOB_WEBHOOK_SECRET not configured - rejecting webhook (fail closed)');
    return false;
  }

  if (!signature) {
    return false;
  }

  // Lob uses HMAC-SHA256 for webhook signatures
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Map Lob event type to our internal status
 */
function mapEventToStatus(eventType: string): string | null {
  const statusMap: Record<string, string> = {
    'letter.created': 'created',
    'letter.rendered_pdf': 'processing',
    'letter.rendered_thumbnails': 'processing',
    'letter.in_transit': 'in_transit',
    'letter.in_local_area': 'in_local_area',
    'letter.processed_for_delivery': 'out_for_delivery',
    'letter.re-routed': 're_routed',
    'letter.returned_to_sender': 'returned',
    'letter.delivered': 'delivered',
    'letter.failed': 'failed',
  };

  return statusMap[eventType] || null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('📬 Received Lob webhook');

  try {
    // Read raw body for HMAC signature verification (bodyParser is disabled)
    const rawBodyBuf = await getRawBody(req);
    const rawBody = rawBodyBuf.toString('utf8');
    const signature = req.headers['lob-signature'] as string | undefined;

    // Verify signature
    if (!verifyLobSignature(rawBody, signature)) {
      console.error('Invalid Lob webhook signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse JSON from raw body (since bodyParser is disabled)
    let event: LobWebhookEvent;
    try {
      event = JSON.parse(rawBody) as LobWebhookEvent;
    } catch {
      console.error('Invalid JSON in Lob webhook body');
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    const eventType = event.event_type?.id;
    const lobLetterId = event.body?.id;

    console.log(`  Event: ${eventType}, Letter: ${lobLetterId}`);

    if (!eventType || !lobLetterId) {
      return res.status(400).json({ error: 'Missing event type or letter ID' });
    }

    // Find the letter in our database
    const { data: letter, error: letterError } = await supabaseAdmin
      .from('contest_letters')
      .select('id, ticket_id, user_id, status, lob_letter_id')
      .eq('lob_letter_id', lobLetterId)
      .maybeSingle();

    if (letterError || !letter) {
      console.log(`  Letter not found for Lob ID: ${lobLetterId}`);
      // Return 200 to acknowledge receipt — returning 4xx/5xx causes Lob to retry
      // infinitely. If the letter doesn't exist, retrying won't help.
      return res.status(200).json({ received: true, note: 'Letter not found in database' });
    }

    // Map event to status
    const newStatus = mapEventToStatus(eventType);
    if (!newStatus) {
      console.log(`  Unknown event type: ${eventType}`);
      return res.status(200).json({ received: true, note: 'Unknown event type' });
    }

    // Update letter with tracking info
    const updateData: Record<string, any> = {
      delivery_status: newStatus,
      last_tracking_update: new Date().toISOString(),
    };

    // Add tracking events if present
    if (event.body.tracking_events && event.body.tracking_events.length > 0) {
      updateData.tracking_events = event.body.tracking_events;
    }

    // Update expected delivery if present
    if (event.body.expected_delivery_date) {
      updateData.expected_delivery_date = event.body.expected_delivery_date;
    }

    // Mark as delivered if that's the event
    if (newStatus === 'delivered') {
      updateData.delivered_at = new Date().toISOString();
    }

    // Terminal letter statuses that should NOT be overwritten by delivery events
    const TERMINAL_LETTER_STATUSES = ['won', 'lost', 'reduced', 'dismissed', 'upheld'];
    const letterInTerminalState = TERMINAL_LETTER_STATUSES.includes(letter.status);

    // Mark as returned if that's the event — but don't overwrite contest outcome statuses
    if (newStatus === 'returned' && !letterInTerminalState) {
      updateData.returned_at = new Date().toISOString();
      updateData.status = 'returned';
    }

    // Mark as failed if that's the event — but don't overwrite contest outcome statuses
    if (newStatus === 'failed' && !letterInTerminalState) {
      updateData.failed_at = new Date().toISOString();
      updateData.status = 'failed';
    }

    // Update the letter
    const { error: updateError } = await supabaseAdmin
      .from('contest_letters')
      .update(updateData)
      .eq('id', letter.id);

    if (updateError) {
      console.error('  Error updating letter:', updateError);
      return res.status(500).json({ error: 'Failed to update letter' });
    }

    // Also update ticket status for terminal letter events (delivered/returned/failed)
    // Guard: don't overwrite terminal outcome statuses (won/lost/dismissed/upheld/paid)
    const TERMINAL_TICKET_STATUSES = ['dismissed', 'upheld', 'paid', 'won', 'lost', 'skipped'];
    if (newStatus === 'delivered' || newStatus === 'returned' || newStatus === 'failed') {
      const ticketStatus = newStatus === 'returned' ? 'letter_returned' : newStatus === 'failed' ? 'letter_failed' : 'mailed';
      const { data: ticketUpdate } = await supabaseAdmin
        .from('detected_tickets')
        .update({ status: ticketStatus })
        .eq('id', letter.ticket_id)
        .not('status', 'in', `(${TERMINAL_TICKET_STATUSES.join(',')})`)
        .select('id');
      if (ticketUpdate && ticketUpdate.length > 0) {
        console.log(`  Updated ticket ${letter.ticket_id} status to "${ticketStatus}"`);
      } else {
        console.log(`  Skipped ticket ${letter.ticket_id} status update — already in terminal state`);
      }
    }

    // Log to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: `letter_${newStatus}`,
        details: {
          lob_event_id: event.id,
          lob_letter_id: lobLetterId,
          event_type: eventType,
          tracking_events: event.body.tracking_events,
        },
        performed_by: 'lob_webhook',
      });

    // Send notification for important events
    if (newStatus === 'delivered' || newStatus === 'returned' || newStatus === 'failed') {
      await sendDeliveryNotification(letter.user_id, letter.ticket_id, newStatus);
    }

    console.log(`  ✅ Updated letter ${letter.id} to status: ${newStatus}`);

    return res.status(200).json({ received: true, status: newStatus });

  } catch (error) {
    console.error('❌ Lob webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Send notification when letter is delivered or returned
 */
async function sendDeliveryNotification(
  userId: string,
  ticketId: string,
  status: 'delivered' | 'returned' | 'failed'
): Promise<void> {
  // Get user email
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) {
    return;
  }

  // Get ticket details
  const { data: ticket } = await supabaseAdmin
    .from('detected_tickets')
    .select('ticket_number')
    .eq('id', ticketId)
    .maybeSingle();

  // Get user profile
  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .maybeSingle();

  const firstName = profile?.first_name || 'there';
  const ticketNumber = ticket?.ticket_number || 'Unknown';
  const email = userData.user.email;

  if (!process.env.RESEND_API_KEY) {
    console.log(`  RESEND not configured, would send delivery notification to ${email}`);
    return;
  }

  try {
    const { Resend } = await import('resend');
    const resend = new Resend(process.env.RESEND_API_KEY);

    if (status === 'delivered') {
      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [email],
        subject: `Your Contest Letter Was Delivered - Ticket #${ticketNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Your Contest Letter Was Delivered</h1>
              <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
            </div>

            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                Hi ${firstName},
              </p>

              <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
                Your contest letter for ticket #${ticketNumber} has been delivered to the City of Chicago's Department of Finance.
              </p>

              <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 16px; color: #166534; font-weight: bold;">
                  Now we wait for the city's decision.
                </p>
                <p style="margin: 8px 0 0; font-size: 14px; color: #166534;">
                  The city typically responds within 2-4 weeks. You'll receive their decision by mail at your home address.
                </p>
              </div>

              <p style="margin: 0; font-size: 13px; color: #9CA3AF; text-align: center;">
                Questions? Reply to this email or contact support@autopilotamerica.com
              </p>
            </div>
          </div>
        `,
      });
    } else if (status === 'returned') {
      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [email],
        subject: `Action Required: Contest Letter Returned - Ticket #${ticketNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #DC2626 0%, #EF4444 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Contest Letter Returned</h1>
              <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
            </div>

            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                Hi ${firstName},
              </p>

              <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
                Unfortunately, your contest letter for ticket #${ticketNumber} was returned to sender. This usually happens due to an address issue.
              </p>

              <div style="background: #FEF2F2; border: 1px solid #FECACA; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 16px; color: #991B1B; font-weight: bold;">
                  What to do next:
                </p>
                <ol style="margin: 8px 0 0; padding-left: 20px; font-size: 14px; color: #991B1B;">
                  <li>Check your mailing address in your profile settings</li>
                  <li>Contact support if you need help</li>
                  <li>We may be able to resend the letter</li>
                </ol>
              </div>

              <div style="text-align: center; margin-bottom: 20px;">
                <a href="https://autopilotamerica.com/settings"
                   style="display: inline-block; background: #0F172A; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
                  Check Your Settings
                </a>
              </div>

              <p style="margin: 0; font-size: 13px; color: #9CA3AF; text-align: center;">
                Questions? Reply to this email or contact support@autopilotamerica.com
              </p>
            </div>
          </div>
        `,
      });
    } else if (status === 'failed') {
      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [email],
        subject: `Action Required: Contest Letter Failed - Ticket #${ticketNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #DC2626 0%, #EF4444 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">Contest Letter Could Not Be Sent</h1>
              <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
            </div>

            <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
              <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
                Hi ${firstName},
              </p>

              <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
                We were unable to process your contest letter for ticket #${ticketNumber}. Our team has been notified and will investigate.
              </p>

              <div style="background: #FEF2F2; border: 1px solid #FECACA; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p style="margin: 0; font-size: 16px; color: #991B1B; font-weight: bold;">
                  We're working on it.
                </p>
                <p style="margin: 8px 0 0; font-size: 14px; color: #991B1B;">
                  Our team will attempt to resend your letter. If additional information is needed, we'll reach out to you directly.
                </p>
              </div>

              <p style="margin: 0; font-size: 13px; color: #9CA3AF; text-align: center;">
                Questions? Reply to this email or contact support@autopilotamerica.com
              </p>
            </div>
          </div>
        `,
      });
    }

    console.log(`  ✅ Sent ${status} notification to ${email}`);

  } catch (error) {
    console.error(`  ❌ Failed to send ${status} notification:`, error);
  }
}

// Disable body parser to get raw body for HMAC signature verification.
// JSON.stringify(req.body) produces different bytes than the original payload,
// so HMAC verification fails silently when bodyParser is true.
export const config = {
  api: {
    bodyParser: false,
  },
};
