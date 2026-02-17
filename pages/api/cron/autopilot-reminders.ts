/**
 * Autopilot Reminder Cron — Runs daily at 16:00 UTC
 *
 * Sends follow-up reminder emails to users with pending tickets:
 *   - Day 5 reminder: "You have X days left — submit evidence to strengthen your letter"
 *   - Day 10 reminder: "11 days remaining — submit evidence soon"
 *   - Day 17 LAST CHANCE: "Your letter will auto-send in 48 hours if not approved"
 *
 * Also handles the day 19 safety-net auto-send (triggers letter generation + approval bypass)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';

interface PendingTicket {
  id: string;
  user_id: string;
  ticket_number: string;
  violation_type: string;
  violation_description: string | null;
  violation_date: string;
  amount: number | null;
  plate: string;
  status: string;
  reminder_count: number;
  last_reminder_sent_at: string | null;
  last_chance_sent_at: string | null;
  auto_send_deadline: string | null;
  evidence_deadline: string | null;
}

function daysSinceTicket(violationDate: string): number {
  const ticketDate = new Date(violationDate);
  return Math.floor((Date.now() - ticketDate.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

async function getUserEmail(userId: string): Promise<{ email: string | null; firstName: string | null }> {
  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
  const email = authUser?.user?.email || null;

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .single();

  return { email, firstName: profile?.first_name || null };
}

async function sendReminderEmail(
  email: string,
  firstName: string,
  ticket: PendingTicket,
  daysElapsed: number,
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;

  const daysRemaining = Math.max(0, 21 - daysElapsed);
  const violationDateFormatted = formatDate(ticket.violation_date);
  const contestDeadlineDate = new Date(new Date(ticket.violation_date).getTime() + 21 * 24 * 60 * 60 * 1000);
  const formattedDeadline = formatDate(contestDeadlineDate.toISOString());

  const urgencyColor = daysRemaining <= 7 ? '#DC2626' : daysRemaining <= 14 ? '#F59E0B' : '#3B82F6';
  const urgencyBg = daysRemaining <= 7 ? '#FEF2F2' : daysRemaining <= 14 ? '#FEF3C7' : '#EFF6FF';
  const urgencyBorder = daysRemaining <= 7 ? '#FECACA' : daysRemaining <= 14 ? '#FDE68A' : '#BFDBFE';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: ${urgencyColor}; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 22px;">${daysRemaining} Days Left to Contest Ticket #${ticket.ticket_number}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Your contest deadline is ${formattedDeadline}</p>
      </div>

      <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <p style="margin: 0 0 16px; font-size: 16px; color: #374151;">Hi ${firstName},</p>

        <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
          This is a reminder about your ${ticket.violation_description || ticket.violation_type?.replace(/_/g, ' ')} ticket
          ${ticket.amount ? `($${ticket.amount.toFixed(2)})` : ''} from ${violationDateFormatted}.
        </p>

        <div style="background: ${urgencyBg}; border: 1px solid ${urgencyBorder}; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 15px; color: ${urgencyColor}; font-weight: 600;">
            ${daysRemaining <= 7
              ? `Only ${daysRemaining} days remaining. After the deadline, the ticket cannot be contested and the full fine applies.`
              : `${daysRemaining} days remaining to contest. Tickets contested earlier tend to have higher win rates.`
            }
          </p>
        </div>

        <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 12px; font-size: 15px; color: #374151;">What to do next:</h3>
          <ol style="margin: 0; padding-left: 20px; font-size: 14px; color: #4B5563; line-height: 1.8;">
            <li><strong>Reply to this email</strong> with any photos, receipts, or details about why the ticket was wrong</li>
            <li>We'll build your AI-powered contest letter and email it to you for approval</li>
            <li>Once you approve, we'll print and mail it to the city</li>
          </ol>
        </div>

        <div style="background: #F0FDF4; border: 1px solid #86EFAC; border-radius: 8px; padding: 16px;">
          <p style="margin: 0; font-size: 13px; color: #166534;">
            <strong>Already provided evidence or don't have any?</strong> No problem. We've already gathered automated evidence from weather records, FOIA data, GPS history, and Street View. We'll generate your letter and send it for your review soon.
          </p>
        </div>
      </div>

      <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px;">
        You're receiving this because you have Autopilot ticket monitoring enabled.<br>
        <a href="https://autopilotamerica.com/settings" style="color: #6B7280;">Manage settings</a>
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [email],
        subject: `Reminder: ${daysRemaining} days left to contest ticket #${ticket.ticket_number}`,
        html,
        replyTo: `evidence+${ticket.id}@autopilotamerica.com`,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error(`  Failed reminder email: ${error}`);
    return false;
  }
}

async function sendLastChanceEmail(
  email: string,
  firstName: string,
  ticket: PendingTicket,
): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false;

  const daysElapsed = daysSinceTicket(ticket.violation_date);
  const daysRemaining = Math.max(0, 21 - daysElapsed);
  const violationDateFormatted = formatDate(ticket.violation_date);

  // Check if there's a letter already generated for this ticket
  const { data: letter } = await supabaseAdmin
    .from('contest_letters')
    .select('id, status, letter_content')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const hasLetter = letter && (letter.status === 'pending_approval' || letter.status === 'needs_approval' || letter.status === 'draft' || letter.status === 'pending_evidence');
  const letterPreview = hasLetter && letter.letter_content
    ? letter.letter_content.substring(0, 400) + (letter.letter_content.length > 400 ? '...' : '')
    : null;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #DC2626; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="margin: 0; font-size: 22px;">LAST CHANCE: Ticket #${ticket.ticket_number}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9; font-size: 14px;">Your contest letter will auto-send in ~48 hours to meet the deadline</p>
      </div>

      <div style="background: white; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
        <p style="margin: 0 0 16px; font-size: 16px; color: #374151;">Hi ${firstName},</p>

        <p style="margin: 0 0 20px; font-size: 15px; color: #4b5563;">
          Your ${ticket.violation_description || ticket.violation_type?.replace(/_/g, ' ')} ticket
          ${ticket.amount ? `($${ticket.amount.toFixed(2)})` : ''} from ${violationDateFormatted}
          has a contest deadline in approximately <strong>${daysRemaining} days</strong>.
        </p>

        <div style="background: #FEF2F2; border: 2px solid #DC2626; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 15px; color: #991B1B; font-weight: 600;">
            To ensure your ticket is contested before the deadline, we will automatically mail your contest letter in approximately 48 hours with whatever evidence we have.
          </p>
          <p style="margin: 12px 0 0; font-size: 13px; color: #991B1B;">
            A contested ticket &mdash; even without personal evidence &mdash; is better than an uncontested fine. Our automated evidence (weather, FOIA records, GPS data) may still support a strong case.
          </p>
        </div>

        ${letterPreview ? `
        <div style="background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 8px; font-size: 14px; color: #374151;">Letter preview:</h3>
          <p style="margin: 0; font-size: 12px; color: #6B7280; white-space: pre-wrap; font-family: Georgia, serif; line-height: 1.5;">${letterPreview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>
        </div>
        ` : ''}

        <h3 style="margin: 0 0 12px; font-size: 15px; color: #374151;">Your options:</h3>
        <ul style="margin: 0 0 20px; padding-left: 20px; font-size: 14px; color: #4B5563; line-height: 1.8;">
          <li><strong>Reply now</strong> with any evidence and we'll regenerate a stronger letter</li>
          <li><strong>Do nothing</strong> and we'll auto-mail the current letter before the deadline</li>
          <li><strong>Visit <a href="${BASE_URL}/settings" style="color: #2563eb;">your settings</a></strong> to cancel auto-mailing for this ticket</li>
        </ul>

        <p style="margin: 0; font-size: 13px; color: #6B7280;">
          Questions? Reply to this email anytime.
        </p>
      </div>

      <p style="text-align: center; font-size: 12px; color: #9ca3af; margin-top: 20px;">
        You're receiving this because you have Autopilot ticket monitoring enabled.<br>
        <a href="https://autopilotamerica.com/settings" style="color: #6B7280;">Manage settings</a>
      </p>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [email],
        subject: `LAST CHANCE: Contest letter for ticket #${ticket.ticket_number} auto-sends in 48 hours`,
        html,
        replyTo: `evidence+${ticket.id}@autopilotamerica.com`,
      }),
    });

    return response.ok;
  } catch (error) {
    console.error(`  Failed last chance email: ${error}`);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting Autopilot reminder check...');

  try {
    // Get all tickets in pending states that haven't been mailed yet
    const { data: tickets } = await supabaseAdmin
      .from('detected_tickets')
      .select('id, user_id, ticket_number, violation_type, violation_description, violation_date, amount, plate, status, reminder_count, last_reminder_sent_at, last_chance_sent_at, auto_send_deadline, evidence_deadline')
      .in('status', ['pending_evidence', 'needs_approval', 'found', 'letter_generated'])
      .not('violation_date', 'is', null)
      .order('violation_date', { ascending: true });

    if (!tickets || tickets.length === 0) {
      console.log('No pending tickets need reminders');
      return res.status(200).json({ success: true, message: 'No tickets to remind about', reminders: 0 });
    }

    console.log(`Checking ${tickets.length} pending tickets for reminders`);

    let remindersSent = 0;
    let lastChanceSent = 0;
    let autoSendTriggered = 0;

    for (const ticket of tickets as PendingTicket[]) {
      if (!ticket.violation_date) continue;

      const daysElapsed = daysSinceTicket(ticket.violation_date);
      const daysRemaining = 21 - daysElapsed;

      // Skip tickets that are past the 21-day deadline entirely
      if (daysRemaining < 0) continue;

      const { email, firstName } = await getUserEmail(ticket.user_id);
      if (!email) continue;

      const name = firstName || 'there';

      // ── Day 19+ AUTO-SEND SAFETY NET ──
      // Force the letter through regardless of approval status
      if (daysElapsed >= 19 && !ticket.last_chance_sent_at) {
        // If we haven't even sent a last-chance email, send it now and
        // let the mail cron handle auto-sending on its next run
        const sent = await sendLastChanceEmail(email, name, ticket);
        if (sent) {
          lastChanceSent++;
          await supabaseAdmin
            .from('detected_tickets')
            .update({
              last_chance_sent_at: new Date().toISOString(),
            })
            .eq('id', ticket.id);
        }
      }

      if (daysElapsed >= 19) {
        // Trigger auto-send: update ticket status so mail-letters cron picks it up
        // This bypasses the approval requirement
        if (ticket.status === 'pending_evidence' || ticket.status === 'needs_approval') {
          console.log(`  Day ${daysElapsed}: Auto-sending ticket ${ticket.ticket_number} (safety net)`);
          await supabaseAdmin
            .from('detected_tickets')
            .update({
              status: 'approved', // bypass approval
              auto_send_deadline: new Date().toISOString(),
            })
            .eq('id', ticket.id);

          // Also update the letter status
          await supabaseAdmin
            .from('contest_letters')
            .update({
              status: 'approved',
              approved_at: new Date().toISOString(),
              approved_via: 'auto_deadline_safety_net',
            })
            .eq('ticket_id', ticket.id)
            .in('status', ['pending_evidence', 'pending_approval', 'draft']);

          // Audit log
          await supabaseAdmin
            .from('ticket_audit_log')
            .insert({
              ticket_id: ticket.id,
              user_id: ticket.user_id,
              action: 'auto_send_safety_net',
              details: {
                days_elapsed: daysElapsed,
                days_remaining: daysRemaining,
                reason: 'Day 19 safety net - auto-sending before 21-day deadline',
              },
              performed_by: 'autopilot_cron',
            });

          autoSendTriggered++;
        }
        continue;
      }

      // ── Day 17 LAST CHANCE EMAIL ──
      if (daysElapsed >= 17 && !ticket.last_chance_sent_at) {
        console.log(`  Day ${daysElapsed}: Sending last-chance email for ticket ${ticket.ticket_number}`);
        const sent = await sendLastChanceEmail(email, name, ticket);
        if (sent) {
          lastChanceSent++;
          await supabaseAdmin
            .from('detected_tickets')
            .update({
              last_chance_sent_at: new Date().toISOString(),
            })
            .eq('id', ticket.id);

          await supabaseAdmin
            .from('ticket_audit_log')
            .insert({
              ticket_id: ticket.id,
              user_id: ticket.user_id,
              action: 'last_chance_email_sent',
              details: {
                days_elapsed: daysElapsed,
                days_remaining: daysRemaining,
              },
              performed_by: 'autopilot_cron',
            });
        }
        continue; // Don't also send a regular reminder
      }

      // ── Day 5 FIRST REMINDER ──
      if (daysElapsed >= 5 && (ticket.reminder_count || 0) === 0) {
        console.log(`  Day ${daysElapsed}: Sending first reminder for ticket ${ticket.ticket_number}`);
        const sent = await sendReminderEmail(email, name, ticket, daysElapsed);
        if (sent) {
          remindersSent++;
          await supabaseAdmin
            .from('detected_tickets')
            .update({
              reminder_count: 1,
              last_reminder_sent_at: new Date().toISOString(),
            })
            .eq('id', ticket.id);
        }
        continue;
      }

      // ── Day 10 SECOND REMINDER ──
      if (daysElapsed >= 10 && (ticket.reminder_count || 0) === 1) {
        console.log(`  Day ${daysElapsed}: Sending second reminder for ticket ${ticket.ticket_number}`);
        const sent = await sendReminderEmail(email, name, ticket, daysElapsed);
        if (sent) {
          remindersSent++;
          await supabaseAdmin
            .from('detected_tickets')
            .update({
              reminder_count: 2,
              last_reminder_sent_at: new Date().toISOString(),
            })
            .eq('id', ticket.id);
        }
        continue;
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`Complete: ${remindersSent} reminders, ${lastChanceSent} last-chance, ${autoSendTriggered} auto-sends`);

    return res.status(200).json({
      success: true,
      ticketsChecked: tickets.length,
      remindersSent,
      lastChanceSent,
      autoSendTriggered,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Reminder cron error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export const config = {
  maxDuration: 120,
};
