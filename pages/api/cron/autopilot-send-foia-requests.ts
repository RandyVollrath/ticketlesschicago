/**
 * Cron: Send Queued FOIA Requests
 *
 * Processes FOIA requests in the `ticket_foia_requests` table with status='queued'.
 * Sends an email to DOFfoia@cityofchicago.org requesting enforcement records
 * for each ticket.
 *
 * FOIA requests are queued at ticket DETECTION time (by autopilot-check-plates.ts),
 * NOT at mailing time. This ensures the city's 5-business-day response deadline
 * expires well before the contest letter is generated (~day 17), giving us a
 * ready-made "Prima Facie Case Not Established" argument.
 *
 * The FOIA request asks for:
 * - Officer's field notes and observations
 * - Photographs taken at the scene
 * - Handheld device data and timestamps
 * - Violation-specific records (meter calibration, sign surveys, etc.)
 *
 * Schedule: Daily (sends queued requests filed at detection)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  sendFoiaRequestEmail,
  generateFoiaRequestEmail,
} from '../../../lib/foia-request-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Map violation_type strings to the keys used in foia-request-service
const VIOLATION_TYPE_MAP: Record<string, string> = {
  'street cleaning': 'street_cleaning',
  'expired meter': 'expired_meter',
  'expired plates': 'expired_plates',
  'no city sticker': 'no_city_sticker',
  'fire hydrant': 'fire_hydrant',
  'residential permit': 'residential_permit',
  'no standing': 'no_standing_time_restricted',
  'time restricted': 'no_standing_time_restricted',
  'snow route': 'snow_route',
  'bike lane': 'bike_lane',
  'bus lane': 'bus_lane',
  'speed camera': 'speed_camera',
  'red light': 'red_light',
  'parking prohibited': 'parking_prohibited',
  'commercial loading': 'commercial_loading',
  'disabled zone': 'disabled_zone',
  'handicapped': 'disabled_zone',
  'double parking': 'double_parking',
  'missing plate': 'missing_plate',
  'parking alley': 'parking_alley',
  'bus stop': 'bus_stop',
};

function normalizeViolationType(rawType: string | null): string {
  if (!rawType) return 'other_unknown';
  const lower = rawType.toLowerCase().trim();
  // Try direct match
  if (VIOLATION_TYPE_MAP[lower]) return VIOLATION_TYPE_MAP[lower];
  // Try partial match
  for (const [key, value] of Object.entries(VIOLATION_TYPE_MAP)) {
    if (lower.includes(key)) return value;
  }
  return 'other_unknown';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📋 Starting FOIA evidence request processing...');

  if (!process.env.RESEND_API_KEY) {
    console.error('RESEND_API_KEY not configured');
    return res.status(500).json({ error: 'RESEND_API_KEY not configured' });
  }

  // Fetch queued FOIA requests (50 per run — Resend allows 100/day on free tier)
  const { data: queuedRequests, error: fetchError } = await supabaseAdmin
    .from('ticket_foia_requests' as any)
    .select('*')
    .eq('status', 'queued')
    .order('requested_at', { ascending: true })
    .limit(50);

  if (fetchError) {
    console.error('Failed to fetch queued FOIA requests:', fetchError.message);
    return res.status(500).json({ error: fetchError.message });
  }

  if (!queuedRequests || queuedRequests.length === 0) {
    console.log('No queued FOIA requests to process.');
    return res.status(200).json({ message: 'No queued requests', processed: 0 });
  }

  console.log(`Found ${queuedRequests.length} queued FOIA requests`);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const request of queuedRequests) {
    const ticketId = request.ticket_id;
    const ticketNumber = request.request_payload?.ticket_number || 'Unknown';
    console.log(`\n  Processing FOIA request for ticket ${ticketNumber} (${request.id})`);

    try {
      // Mark as drafting
      await supabaseAdmin
        .from('ticket_foia_requests' as any)
        .update({ status: 'drafting', updated_at: new Date().toISOString() })
        .eq('id', request.id);

      // Fetch the detected ticket details
      const { data: ticket, error: ticketError } = await supabaseAdmin
        .from('detected_tickets')
        .select('*')
        .eq('id', ticketId)
        .single();

      if (ticketError || !ticket) {
        console.error(`    Ticket ${ticketId} not found: ${ticketError?.message}`);
        await markFailed(request.id, `Ticket not found: ${ticketError?.message}`);
        failed++;
        continue;
      }

      // Fetch user profile for name and address
      const { data: profile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('first_name, last_name, full_name, mailing_address, mailing_city, mailing_state, mailing_zip, street_address, zip_code, email')
        .eq('user_id', request.user_id)
        .single();

      if (profileError || !profile) {
        console.error(`    User profile not found for ${request.user_id}: ${profileError?.message}`);
        await markFailed(request.id, `User profile not found`);
        failed++;
        continue;
      }

      // Build requester name
      const requesterName = profile.full_name
        || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
        || 'Vehicle Owner';

      // Build requester address
      const street = profile.mailing_address || profile.street_address || '';
      const city = profile.mailing_city || 'Chicago';
      const state = profile.mailing_state || 'IL';
      const zip = profile.mailing_zip || profile.zip_code || '';

      if (!street || !zip) {
        console.log(`    Skipping: user has no mailing address on file`);
        await supabaseAdmin
          .from('ticket_foia_requests' as any)
          .update({
            status: 'not_needed',
            notes: 'User has no mailing address - cannot send FOIA request',
            updated_at: new Date().toISOString(),
          })
          .eq('id', request.id);
        skipped++;
        continue;
      }

      const requesterAddress = `${street}, ${city}, ${state} ${zip}`;

      // Get user email (for reply-to on FOIA)
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(request.user_id);
      const userEmail = profile.email || authUser?.user?.email || '';

      if (!userEmail) {
        console.log(`    Skipping: no email for user`);
        await markFailed(request.id, 'No user email found');
        failed++;
        continue;
      }

      // Build violation info
      const violationType = normalizeViolationType(ticket.violation_type);
      const violationDate = ticket.violation_date
        ? new Date(ticket.violation_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        : 'Unknown date';
      const violationLocation = ticket.location || 'Location per citation';
      const violationDescription = ticket.violation_description || ticket.violation_type || 'Parking violation';

      // Send the FOIA email
      const result = await sendFoiaRequestEmail({
        ticketNumber: ticket.ticket_number,
        violationDate,
        violationLocation,
        violationType,
        violationDescription,
        requesterName,
        requesterEmail: userEmail,
        requesterAddress,
        plate: ticket.plate || 'On file',
      });

      if (result.success) {
        console.log(`    ✅ FOIA request sent (Resend ID: ${result.emailId})`);

        // Update status to sent
        await supabaseAdmin
          .from('ticket_foia_requests' as any)
          .update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            response_payload: { resend_email_id: result.emailId },
            notes: `Sent to DOFfoia@cityofchicago.org on behalf of ${requesterName}`,
          })
          .eq('id', request.id);

        // Audit log
        await supabaseAdmin
          .from('ticket_audit_log')
          .insert({
            ticket_id: ticketId,
            action: 'foia_request_sent',
            details: {
              resend_email_id: result.emailId,
              recipient: 'DOFfoia@cityofchicago.org',
              requester: requesterName,
              violation_type: violationType,
            },
            performed_by: null,
          });

        // Also send the user a notification that we filed on their behalf
        await notifyUserOfFoiaFiling(userEmail, requesterName, ticket.ticket_number, violationDate, violationType);

        sent++;
      } else {
        console.error(`    ❌ Failed to send: ${result.error}`);
        await markFailed(request.id, result.error || 'Send failed');
        failed++;
      }
    } catch (err: any) {
      console.error(`    ❌ Exception: ${err.message}`);
      await markFailed(request.id, err.message);
      failed++;
    }

    // Small delay between emails to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  const summary = { processed: queuedRequests.length, sent, failed, skipped };
  console.log(`\n📋 FOIA request processing complete:`, summary);

  return res.status(200).json(summary);
}

async function markFailed(requestId: string, error: string) {
  await supabaseAdmin
    .from('ticket_foia_requests' as any)
    .update({
      status: 'failed',
      notes: error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', requestId);
}

/**
 * Send the user a notification that we filed a FOIA request on their behalf.
 * This is a key marketing/value demonstration moment.
 */
async function notifyUserOfFoiaFiling(
  userEmail: string,
  userName: string,
  ticketNumber: string,
  violationDate: string,
  violationType: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 22px;">We Filed a Records Request on Your Behalf</h1>
        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Demanding the city prove their case against you</p>
      </div>
      <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="color: #374151; font-size: 15px; line-height: 1.6;">Hi ${userName},</p>

        <p style="color: #374151; font-size: 15px; line-height: 1.6;">
          We just filed an official <strong>Freedom of Information Act (FOIA) request</strong> with the
          Chicago Department of Finance demanding the enforcement records for your
          ticket <strong>#${ticketNumber}</strong> (${violationDate}).
        </p>

        <div style="background: #f5f3ff; border: 1px solid #c4b5fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 12px; color: #5b21b6; font-size: 16px;">What We Requested</h3>
          <ul style="margin: 0; padding-left: 20px; color: #6d28d9; font-size: 14px; line-height: 1.8;">
            <li>The officer's handwritten notes and observations</li>
            <li>Any photos taken at the scene</li>
            <li>Handheld device data and GPS timestamps</li>
            <li>Violation-specific enforcement records</li>
          </ul>
        </div>

        <div style="background: #ecfdf5; border: 1px solid #6ee7b7; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px; color: #065f46; font-size: 16px;">Why This Matters</h3>
          <p style="margin: 0; color: #047857; font-size: 14px; line-height: 1.6;">
            The city is required by law to respond within <strong>5 business days</strong>.
            We file this request as soon as we detect your ticket so that by the time we
            draft your contest letter, the deadline has already passed. If the city fails
            to produce these records, your letter will argue
            <strong>"Prima Facie Case Not Established by City"</strong> &mdash; one of the
            top reasons tickets get dismissed in Chicago.
          </p>
        </div>

        <div style="background: #f9fafb; border: 1px solid #e5e7eb; padding: 16px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0; color: #6b7280; font-size: 13px; line-height: 1.6;">
            <strong>What happens next:</strong> The city has 5 business days to respond.
            Whether they produce records or not, it works in your favor &mdash;
            incomplete or missing records weaken their case.
            We'll incorporate the results into your contest letter automatically.
          </p>
        </div>

        <p style="color: #374151; font-size: 14px; line-height: 1.6;">
          You don't need to do anything. We're handling this for you.
        </p>

        <p style="color: #6b7280; font-size: 12px; margin-top: 24px; text-align: center;">
          Autopilot America &mdash; Fighting your ticket from every angle
        </p>
      </div>
    </div>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [userEmail],
        subject: `We filed a records request for Ticket #${ticketNumber} - demanding the city prove their case`,
        html,
      }),
    });
  } catch (err: any) {
    console.error(`Failed to notify user of FOIA filing: ${err.message}`);
  }
}
