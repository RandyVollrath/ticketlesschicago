import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { runContestPipelineSmokeTest, smokeResultAsHtml } from '../../../lib/contest-pipeline-smoke';

/**
 * Cron Job: Daily Admin Digest — Pending Contest Letters
 *
 * Emails randyvollrath@gmail.com every day with a summary of contest letters
 * that need admin review before mailing. This ensures no letter gets stuck
 * waiting for admin approval indefinitely.
 *
 * Schedule: Daily at 9 AM CT (14:00 UTC)
 */

const ADMIN_EMAIL = 'randyvollrath@gmail.com';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Auth: Vercel cron header OR CRON_SECRET
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);

  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    const resend = process.env.RESEND_API_KEY
      ? new Resend(process.env.RESEND_API_KEY)
      : null;

    if (!resend) {
      throw new Error('RESEND_API_KEY not configured');
    }

    console.log('📋 Admin digest: checking for pending contest letters...');

    // Fetch all letters that need admin review, with ticket details
    const { data: pendingLetters, error: lettersError } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id,
        status,
        created_at,
        updated_at,
        defense_type,
        detected_tickets!inner (
          id,
          ticket_number,
          violation_type,
          violation_date,
          location,
          amount,
          plate,
          evidence_deadline,
          auto_send_deadline,
          user_evidence,
          user_id
        )
      `)
      .in('status', ['needs_admin_review', 'approved', 'ready'])
      .order('created_at', { ascending: true });

    if (lettersError) {
      console.error('Error fetching pending letters:', lettersError);
      throw lettersError;
    }

    // Also check for letters with FOIA data that hasn't been integrated
    const { data: foiaWaitingLetters, error: foiaError } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id,
        status,
        cdot_foia_integrated,
        finance_foia_integrated,
        detected_tickets!inner (
          id,
          ticket_number,
          violation_type,
          location,
          user_id
        )
      `)
      .eq('status', 'admin_approved')
      .or('cdot_foia_integrated.eq.false,finance_foia_integrated.eq.false');

    const foiaWaiting = foiaError ? [] : (foiaWaitingLetters || []);

    // Run the contest-pipeline smoke test before deciding whether to send.
    // We want the email to fire on smoke FAILURE even when there are no
    // pending letters, so a regression in signature verification, the
    // letter validator, or the date formatter gets caught the next morning.
    const smoke = await runContestPipelineSmokeTest();

    if ((!pendingLetters || pendingLetters.length === 0) && foiaWaiting.length === 0 && smoke.passed) {
      console.log('No pending letters and smoke test passed — skipping digest email');
      return res.status(200).json({
        success: true,
        message: 'No pending letters, smoke passed, no email sent',
        pendingCount: 0,
        smokePassed: true,
      });
    }

    // Get user emails for each letter
    const userIds = [
      ...new Set([
        ...(pendingLetters || []).map((l: any) => l.detected_tickets?.user_id),
        ...foiaWaiting.map((l: any) => l.detected_tickets?.user_id),
      ].filter(Boolean)),
    ];

    const userEmailMap: Record<string, string> = {};
    for (const userId of userIds) {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (userData?.user?.email) {
        userEmailMap[userId] = userData.user.email;
      }
    }

    // Build email HTML
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    let html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">
          Admin Digest: Contest Letters Pending Review
        </h2>
        <p style="color: #6b7280; font-size: 14px;">${today}</p>
    `;

    // Section 1: Letters needing admin review
    if (pendingLetters && pendingLetters.length > 0) {
      html += `
        <h3 style="color: #dc2626; margin-top: 24px;">
          ${pendingLetters.length} Letter${pendingLetters.length === 1 ? '' : 's'} Awaiting Admin Approval
        </h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr style="background: #f3f4f6;">
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Ticket</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Type</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Location</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">User</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Evidence</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Auto-Send</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Action</th>
          </tr>
      `;

      for (const letter of pendingLetters) {
        const ticket = (letter as any).detected_tickets;
        if (!ticket) continue;

        const userEmail = userEmailMap[ticket.user_id] || 'Unknown';
        const hasEvidence = !!ticket.user_evidence;
        const evidenceDeadline = ticket.evidence_deadline
          ? new Date(ticket.evidence_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'N/A';
        const autoSendDeadline = ticket.auto_send_deadline
          ? new Date(ticket.auto_send_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : 'N/A';

        // Calculate urgency. The "deadline" we render is auto_send_deadline —
        // the day the cron will mail the letter on its own. Negative values
        // mean we're already past that date, so the previous (URGENT) tag
        // was misleading. Surface "OVERDUE Nd" for past dates instead.
        let urgencyColor = '#6b7280'; // gray
        let urgencyLabel = '';
        if (ticket.auto_send_deadline) {
          const daysUntilAutoSend = Math.ceil(
            (new Date(ticket.auto_send_deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
          );
          if (daysUntilAutoSend < 0) {
            urgencyColor = '#dc2626'; // red
            urgencyLabel = ` (OVERDUE ${Math.abs(daysUntilAutoSend)}d)`;
          } else if (daysUntilAutoSend <= 1) {
            urgencyColor = '#dc2626'; // red
            urgencyLabel = ' (URGENT)';
          } else if (daysUntilAutoSend <= 3) {
            urgencyColor = '#f59e0b'; // amber
            urgencyLabel = ` (${daysUntilAutoSend}d left)`;
          } else {
            urgencyLabel = ` (${daysUntilAutoSend}d left)`;
          }
        }

        const violationType = (ticket.violation_type || 'unknown')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c: string) => c.toUpperCase());

        const ticketPageUrl = `https://autopilotamerica.com/tickets/${ticket.id}`;

        html += `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 12px;">${ticket.ticket_number || 'N/A'}</td>
            <td style="padding: 8px 12px;">${violationType}</td>
            <td style="padding: 8px 12px; max-width: 150px; overflow: hidden; text-overflow: ellipsis;">${ticket.location || 'N/A'}</td>
            <td style="padding: 8px 12px; font-size: 12px;">${userEmail}</td>
            <td style="padding: 8px 12px;">${hasEvidence ? '&#10003; Yes' : '&#10007; No'}</td>
            <td style="padding: 8px 12px; color: ${urgencyColor}; font-weight: 600;">
              ${autoSendDeadline}${urgencyLabel}
            </td>
            <td style="padding: 8px 12px;">
              <a href="${ticketPageUrl}" style="color: #2563eb; text-decoration: none; font-weight: 600;">Review &rarr;</a>
            </td>
          </tr>
        `;
      }

      html += `</table>`;
    }

    // Section 2: FOIA integration status
    if (foiaWaiting.length > 0) {
      html += `
        <h3 style="color: #f59e0b; margin-top: 24px;">
          ${foiaWaiting.length} Letter${foiaWaiting.length === 1 ? '' : 's'} Awaiting FOIA Integration
        </h3>
        <p style="color: #6b7280; font-size: 13px;">
          These letters are admin-approved but missing FOIA data integration.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <tr style="background: #f3f4f6;">
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Ticket</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Type</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">CDOT FOIA</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Finance FOIA</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Action</th>
          </tr>
      `;

      for (const letter of foiaWaiting) {
        const ticket = (letter as any).detected_tickets;
        if (!ticket) continue;

        const cdotStatus = (letter as any).cdot_foia_integrated ? '&#10003; Integrated' : '&#10007; Pending';
        const financeStatus = (letter as any).finance_foia_integrated ? '&#10003; Integrated' : '&#10007; Pending';
        const ticketPageUrl = `https://autopilotamerica.com/tickets/${ticket.id}`;

        const violationType = (ticket.violation_type || 'unknown')
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c: string) => c.toUpperCase());

        html += `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 12px;">${ticket.ticket_number || 'N/A'}</td>
            <td style="padding: 8px 12px;">${violationType}</td>
            <td style="padding: 8px 12px;">${cdotStatus}</td>
            <td style="padding: 8px 12px;">${financeStatus}</td>
            <td style="padding: 8px 12px;">
              <a href="${ticketPageUrl}" style="color: #2563eb; text-decoration: none; font-weight: 600;">Review &rarr;</a>
            </td>
          </tr>
        `;
      }

      html += `</table>`;
    }

    // Summary action items
    html += `
        <div style="margin-top: 24px; padding: 16px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px;">
          <p style="margin: 0; font-size: 14px; color: #0369a1;">
            <strong>Quick Actions:</strong><br>
            &bull; <a href="https://autopilotamerica.com/dashboard" style="color: #2563eb;">Open Dashboard</a> to review all letters<br>
            &bull; Letters that pass the auto-send deadline will be mailed automatically as a safety net
          </p>
        </div>

        ${smokeResultAsHtml(smoke)}
        <p style="color: #9ca3af; font-size: 12px; margin-top: 24px;">
          This is a daily automated digest from Autopilot America.
          Sent at ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })} CT.
        </p>
      </div>
    `;

    // Send the email — smoke failures get a "[ALERT]" subject so they don't
    // get lost in inbox noise.
    const totalReview = (pendingLetters?.length || 0) + foiaWaiting.length;
    const subject = !smoke.passed
      ? `[ALERT] Contest pipeline smoke test FAILED${totalReview > 0 ? ` — also ${totalReview} letter${totalReview === 1 ? '' : 's'} need review` : ''}`
      : `[Admin] ${totalReview} contest letter${totalReview === 1 ? '' : 's'} need${totalReview === 1 ? 's' : ''} review`;

    const { error: sendError } = await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: [ADMIN_EMAIL],
      subject,
      html,
    });

    if (sendError) {
      console.error('Failed to send admin digest:', sendError);
      throw sendError;
    }

    console.log(
      `✅ Admin digest sent: ${pendingLetters?.length || 0} pending review, ${foiaWaiting.length} awaiting FOIA`
    );

    return res.status(200).json({
      success: true,
      pendingReview: pendingLetters?.length || 0,
      foiaWaiting: foiaWaiting.length,
      emailSentTo: ADMIN_EMAIL,
      smokePassed: smoke.passed,
      smokeChecks: smoke.checks.map(c => ({ name: c.name, passed: c.passed, ...(c.passed ? {} : { detail: c.detail }) })),
    });
  } catch (error: any) {
    console.error('Admin digest cron error:', error);
    return res.status(500).json({
      error: 'Failed to send admin digest',
      details: error.message,
    });
  }
}
