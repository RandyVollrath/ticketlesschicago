import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendLetter, formatLetterAsHTML, CHICAGO_PARKING_CONTEST_ADDRESS } from '../../../lib/lob-service';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface LetterToMail {
  id: string;
  ticket_id: string;
  user_id: string;
  letter_content: string;
  letter_text: string;
  defense_type: string | null;
}

interface UserProfile {
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  mailing_address: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
}

interface Subscription {
  letters_used_this_period: number;
  letters_included: number;
}

/**
 * Check if kill switches are active
 */
async function checkKillSwitches(): Promise<{ proceed: boolean; message?: string }> {
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('key, value')
    .in('key', ['pause_all_mail', 'pause_ticket_processing']);

  for (const setting of settings || []) {
    if (setting.key === 'pause_all_mail' && setting.value?.enabled) {
      return { proceed: false, message: 'Kill switch active: mailing disabled' };
    }
  }

  return { proceed: true };
}

/**
 * Mail a single letter via Lob
 */
async function mailLetter(
  letter: LetterToMail,
  profile: UserProfile,
  ticketNumber: string
): Promise<{ success: boolean; lobId?: string; expectedDelivery?: string; pdfUrl?: string; error?: string }> {
  console.log(`  Mailing letter ${letter.id} for ticket ${ticketNumber}...`);

  try {
    // Build sender name
    const senderName = profile.full_name ||
      `${profile.first_name || ''} ${profile.last_name || ''}`.trim() ||
      'Vehicle Owner';

    // Build sender address
    const fromAddress = {
      name: senderName,
      address: profile.mailing_address,
      city: profile.mailing_city,
      state: profile.mailing_state,
      zip: profile.mailing_zip,
    };

    // Get letter content (prefer letter_content, fall back to letter_text)
    const letterText = letter.letter_content || letter.letter_text;
    if (!letterText) {
      throw new Error('No letter content found');
    }

    // Format letter as HTML
    const htmlContent = formatLetterAsHTML(letterText);

    // Send via Lob
    const result = await sendLetter({
      from: fromAddress,
      to: CHICAGO_PARKING_CONTEST_ADDRESS,
      letterContent: htmlContent,
      description: `Contest letter for ticket ${ticketNumber}`,
      metadata: {
        ticket_id: letter.ticket_id,
        letter_id: letter.id,
        user_id: letter.user_id,
      },
    });

    console.log(`    Mailed! Lob ID: ${result.id}`);

    // Update letter record
    await supabaseAdmin
      .from('contest_letters')
      .update({
        status: 'mailed',
        lob_letter_id: result.id,
        letter_pdf_url: result.url,
        tracking_number: result.tracking_number || null,
        mailed_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
      })
      .eq('id', letter.id);

    // Update ticket status
    await supabaseAdmin
      .from('detected_tickets')
      .update({ status: 'mailed' })
      .eq('id', letter.ticket_id);

    // Log to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: 'letter_mailed',
        details: {
          lob_letter_id: result.id,
          tracking_number: result.tracking_number,
          expected_delivery: result.expected_delivery_date,
        },
        performed_by: 'autopilot_cron',
      });

    return {
      success: true,
      lobId: result.id,
      expectedDelivery: result.expected_delivery_date || null,
      pdfUrl: result.url || null,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`    Error mailing letter: ${errorMessage}`);

    // Update letter status to failed
    await supabaseAdmin
      .from('contest_letters')
      .update({ status: 'failed' })
      .eq('id', letter.id);

    // Log error to audit
    await supabaseAdmin
      .from('ticket_audit_log')
      .insert({
        ticket_id: letter.ticket_id,
        user_id: letter.user_id,
        action: 'letter_mail_failed',
        details: { error: errorMessage },
        performed_by: 'autopilot_cron',
      });

    return { success: false, error: errorMessage };
  }
}

/**
 * Send email notification that letter was mailed
 */
async function sendLetterMailedNotification(
  userId: string,
  ticketNumber: string,
  expectedDeliveryDate: string | null,
  pdfUrl: string | null
): Promise<void> {
  // Get user settings
  const { data: settings } = await supabaseAdmin
    .from('autopilot_settings')
    .select('email_on_letter_sent')
    .eq('user_id', userId)
    .single();

  // Default to true if setting doesn't exist
  if (settings && settings.email_on_letter_sent === false) {
    console.log(`  User ${userId} has email_on_letter_sent disabled, skipping notification`);
    return;
  }

  // Get user email and profile
  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) {
    console.log(`  User ${userId} has no email, skipping notification`);
    return;
  }

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .single();

  const firstName = profile?.first_name || 'there';
  const email = userData.user.email;

  if (!resend) {
    console.log(`  RESEND not configured, would send to ${email}: Letter mailed for ticket ${ticketNumber}`);
    return;
  }

  try {
    // Format expected delivery date
    let deliveryText = '';
    if (expectedDeliveryDate) {
      const deliveryDate = new Date(expectedDeliveryDate);
      deliveryText = deliveryDate.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">✉️ Your Contest Letter Has Been Mailed!</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
        </div>

        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 20px; font-size: 16px; color: #374151;">
            Hi ${firstName},
          </p>

          <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
            Great news! Your contest letter for ticket #${ticketNumber} has been printed and mailed to the City of Chicago's Department of Finance.
          </p>

          <div style="background: #F0FDF4; border: 1px solid #86EFAC; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
            <div style="display: flex; align-items: center; margin-bottom: 12px;">
              <span style="font-size: 24px; margin-right: 12px;">📬</span>
              <span style="font-size: 18px; font-weight: bold; color: #166534;">Letter Mailed Successfully</span>
            </div>
            ${deliveryText ? `
            <p style="margin: 0; font-size: 14px; color: #166534;">
              <strong>Expected Delivery:</strong> ${deliveryText}
            </p>
            ` : ''}
          </div>

          <h3 style="margin: 0 0 12px; font-size: 16px; color: #374151;">What happens next?</h3>
          <ol style="margin: 0 0 20px; padding-left: 20px; color: #4b5563; font-size: 14px; line-height: 1.8;">
            <li>The city will receive your letter within 3-5 business days</li>
            <li>They'll review your contest and any evidence provided</li>
            <li>You'll receive a decision by mail, typically within 2-4 weeks</li>
            <li>If successful, the ticket will be dismissed or reduced</li>
          </ol>

          ${pdfUrl ? `
          <div style="text-align: center; margin-bottom: 20px;">
            <a href="${pdfUrl}"
               style="display: inline-block; background: #0F172A; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">
              View Your Letter (PDF)
            </a>
          </div>
          ` : ''}

          <div style="background: #FEF3C7; border: 1px solid #F59E0B; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <p style="margin: 0; font-size: 14px; color: #92400E;">
              <strong>Pro tip:</strong> Keep an eye on your mailbox for the city's response. If you don't hear back within 4 weeks, you can check the ticket status on the <a href="https://www.chicago.gov/city/en/depts/fin/provdrs/parking_and_redlightcitationadministration/svcs/check_ticket_status.html" style="color: #92400E;">City of Chicago website</a>.
            </p>
          </div>

          <p style="margin: 0; font-size: 13px; color: #9CA3AF; text-align: center;">
            Questions? Reply to this email or contact support@autopilotamerica.com
          </p>
        </div>

        <p style="margin: 20px 0 0; font-size: 12px; color: #9CA3AF; text-align: center;">
          You're receiving this because you have Autopilot ticket monitoring enabled.<br>
          <a href="https://autopilotamerica.com/settings" style="color: #6B7280;">Manage notification preferences</a>
        </p>
      </div>
    `;

    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [email],
      subject: `✉️ Contest Letter Mailed - Ticket #${ticketNumber}`,
      html,
    });

    console.log(`  ✅ Sent letter mailed notification to ${email}`);

  } catch (error) {
    console.error(`  ❌ Failed to send letter mailed notification to ${email}:`, error);
  }
}

/**
 * Increment user's letter count and check if they've exceeded included letters
 */
async function incrementLetterCount(userId: string): Promise<{ exceeded: boolean; count: number }> {
  const { data: sub } = await supabaseAdmin
    .from('autopilot_subscriptions')
    .select('letters_used_this_period, letters_included')
    .eq('user_id', userId)
    .single();

  if (!sub) {
    return { exceeded: false, count: 0 };
  }

  const newCount = (sub.letters_used_this_period || 0) + 1;

  await supabaseAdmin
    .from('autopilot_subscriptions')
    .update({ letters_used_this_period: newCount })
    .eq('user_id', userId);

  return {
    exceeded: newCount > (sub.letters_included || 1),
    count: newCount,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📬 Starting Autopilot letter mailing...');

  // Check if LOB_API_KEY is configured
  if (!process.env.LOB_API_KEY) {
    console.error('LOB_API_KEY not configured');
    return res.status(500).json({
      success: false,
      error: 'Lob API key not configured',
    });
  }

  try {
    // Check kill switches
    const killCheck = await checkKillSwitches();
    if (!killCheck.proceed) {
      console.log(`⚠️ ${killCheck.message}`);
      return res.status(200).json({
        success: true,
        message: killCheck.message,
        skipped: true,
      });
    }

    const now = new Date().toISOString();

    // Get all tickets where evidence deadline has passed and status is pending_evidence
    // These are ready to mail
    const { data: readyTickets } = await supabaseAdmin
      .from('detected_tickets')
      .select('id')
      .eq('status', 'pending_evidence')
      .lt('evidence_deadline', now);

    const readyTicketIds = readyTickets?.map(t => t.id) || [];

    // Get letters for these tickets, plus any already approved letters
    // Exclude test tickets from being mailed
    const { data: letters } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id,
        ticket_id,
        user_id,
        letter_content,
        letter_text,
        defense_type,
        detected_tickets!inner (
          id,
          ticket_number,
          status,
          evidence_deadline,
          is_test
        )
      `)
      .or(`status.eq.pending_evidence,status.eq.approved,status.eq.draft`)
      .order('created_at', { ascending: true })
      .limit(20); // Process in batches

    if (!letters || letters.length === 0) {
      console.log('No letters to process');
      return res.status(200).json({
        success: true,
        message: 'No letters to mail',
        lettersMailed: 0,
      });
    }

    // Filter to only letters where evidence_deadline has passed
    // This is the safest approach - either user provided evidence (letter was regenerated with AI)
    // or they didn't (they get the original template letter)
    const readyLetters = letters.filter((l: any) => {
      const ticket = l.detected_tickets;
      if (!ticket) return false;

      // Skip test tickets
      if (ticket.is_test) {
        console.log(`  Skipping test ticket ${ticket.ticket_number}`);
        return false;
      }

      // Only mail if evidence deadline has passed
      if (ticket.evidence_deadline) {
        const deadline = new Date(ticket.evidence_deadline);
        if (deadline <= new Date()) {
          return true;
        }
      }

      return false;
    });

    if (readyLetters.length === 0) {
      console.log('No letters ready to mail (waiting for evidence deadline)');
      return res.status(200).json({
        success: true,
        message: 'No letters ready (waiting for evidence deadlines)',
        lettersMailed: 0,
        pendingEvidence: letters.length,
      });
    }

    console.log(`📋 Processing ${readyLetters.length} letters (${letters.length - readyLetters.length} still waiting for evidence)`);

    let lettersMailed = 0;
    let errors = 0;

    for (const letter of readyLetters) {
      // Get user profile for mailing address
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .eq('user_id', letter.user_id)
        .single();

      if (!profile || !profile.mailing_address) {
        console.log(`  Skipping letter ${letter.id}: Missing profile/address info`);
        errors++;
        continue;
      }

      // Build full name if not present
      if (!profile.full_name) {
        profile.full_name = `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
      }

      const ticketNumber = (letter as any).detected_tickets?.ticket_number || 'Unknown';

      const result = await mailLetter(
        letter as LetterToMail,
        profile as UserProfile,
        ticketNumber
      );

      if (result.success) {
        lettersMailed++;

        // Send email notification to user
        await sendLetterMailedNotification(
          letter.user_id,
          ticketNumber,
          result.expectedDelivery || null,
          result.pdfUrl || null
        );

        // Increment letter count
        const { exceeded, count } = await incrementLetterCount(letter.user_id);
        if (exceeded) {
          console.log(`    User has used ${count} letters (exceeded included amount)`);
          // TODO: Charge for additional letter via Stripe
        }
      } else {
        errors++;
      }

      // Rate limit: 1 second between API calls
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Complete: ${lettersMailed} mailed, ${errors} errors`);

    return res.status(200).json({
      success: true,
      lettersMailed,
      errors,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('❌ Letter mailing error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString(),
    });
  }
}

export const config = {
  maxDuration: 120, // 2 minutes max
};
