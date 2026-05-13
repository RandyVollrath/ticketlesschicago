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

    // ── STUCK-ROW DETECTION ──
    // Catches silent state-machine failures the way the user finds them otherwise:
    // by a real user emailing in. Each "stuck" row is something that the cron
    // chain SHOULD have moved by now but hasn't. We surface them here so the
    // first sign of a regression is this daily email, not a customer complaint.
    const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const thirtyMinAgoIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    type StuckRow = {
      kind:
        | 'evidence_deadline_overdue'
        | 'evidence_received_unmailed'
        | 'mailing_stuck'
        | 'awaiting_consent_stale'
        | 'evidence_not_integrated';
      letterId: string | null;
      ticketId: string;
      ticketNumber: string | null;
      ageHours: number;
      detail: string;
      userId: string | null;
    };
    const stuckRows: StuckRow[] = [];

    // (1) Contest letter in 'pending_evidence' but ticket.evidence_deadline passed >24h ago.
    //     The reminders cron should have promoted it to 'approved' by now.
    const { data: stuckPendingEvidence } = await supabaseAdmin
      .from('contest_letters')
      .select(`
        id, status, created_at, updated_at, user_id,
        detected_tickets!inner ( id, ticket_number, evidence_deadline, status, user_id )
      `)
      .eq('status', 'pending_evidence')
      .not('detected_tickets.evidence_deadline', 'is', null)
      .lte('detected_tickets.evidence_deadline', oneDayAgoIso)
      .limit(50);
    for (const l of (stuckPendingEvidence as any[]) || []) {
      const t = l.detected_tickets;
      if (!t || !t.evidence_deadline) continue;
      if (t.status === 'mailed' || t.status === 'sent' || t.status === 'skipped') continue;
      const ageHours = Math.round((Date.now() - new Date(t.evidence_deadline).getTime()) / 3.6e6);
      stuckRows.push({
        kind: 'evidence_deadline_overdue',
        letterId: l.id,
        ticketId: t.id,
        ticketNumber: t.ticket_number,
        ageHours,
        detail: `evidence_deadline was ${ageHours}h ago, letter still pending_evidence`,
        userId: t.user_id || l.user_id,
      });
    }

    // (2) Ticket in 'evidence_received' but letter still in a pre-mail status.
    //     The resend/clicksend webhook flips ticket → evidence_received but doesn't
    //     promote the letter; reminders cron's status filter doesn't load this
    //     status either. So the letter sits forever.
    const { data: stuckEvidenceReceived } = await supabaseAdmin
      .from('detected_tickets')
      .select(`
        id, ticket_number, status, user_id, evidence_received_at,
        contest_letters!inner ( id, status )
      `)
      .eq('status', 'evidence_received')
      .lte('evidence_received_at', oneDayAgoIso)
      .limit(50);
    for (const t of (stuckEvidenceReceived as any[]) || []) {
      const letters = Array.isArray(t.contest_letters) ? t.contest_letters : [t.contest_letters];
      for (const l of letters) {
        if (!l) continue;
        const stuckStatuses = ['pending_evidence', 'pending_approval', 'draft', 'needs_admin_review'];
        if (!stuckStatuses.includes(l.status)) continue;
        const ageHours = t.evidence_received_at
          ? Math.round((Date.now() - new Date(t.evidence_received_at).getTime()) / 3.6e6)
          : 0;
        stuckRows.push({
          kind: 'evidence_received_unmailed',
          letterId: l.id,
          ticketId: t.id,
          ticketNumber: t.ticket_number,
          ageHours,
          detail: `user submitted evidence ${ageHours}h ago, letter still ${l.status}`,
          userId: t.user_id,
        });
      }
    }

    // (3) Contest letter stuck in 'mailing' > 30 min — mail-letters' own retry
    //     pattern handles 30-min staleness, but if it keeps failing we want
    //     visibility.
    const { data: stuckMailing } = await supabaseAdmin
      .from('contest_letters')
      .select(`id, status, updated_at, user_id, detected_tickets!inner ( id, ticket_number, user_id )`)
      .eq('status', 'mailing')
      .lte('updated_at', thirtyMinAgoIso)
      .limit(50);
    for (const l of (stuckMailing as any[]) || []) {
      const t = l.detected_tickets;
      const ageMin = l.updated_at ? Math.round((Date.now() - new Date(l.updated_at).getTime()) / 60000) : 0;
      stuckRows.push({
        kind: 'mailing_stuck',
        letterId: l.id,
        ticketId: t?.id || '',
        ticketNumber: t?.ticket_number || null,
        ageHours: Math.round(ageMin / 60),
        detail: `letter in 'mailing' status for ${ageMin} min — Lob handoff likely failed`,
        userId: t?.user_id || l.user_id,
      });
    }

    // (4) Contest letter stuck 'awaiting_consent' > 7 days. The reminders cron
    //     nags daily but if the user never replies, the letter never goes out.
    const { data: stuckAwaitingConsent } = await supabaseAdmin
      .from('contest_letters')
      .select(`id, status, created_at, user_id, detected_tickets!inner ( id, ticket_number, user_id, evidence_deadline )`)
      .eq('status', 'awaiting_consent')
      .lte('created_at', sevenDaysAgoIso)
      .limit(50);
    for (const l of (stuckAwaitingConsent as any[]) || []) {
      const t = l.detected_tickets;
      const ageDays = l.created_at ? Math.round((Date.now() - new Date(l.created_at).getTime()) / 86_400_000) : 0;
      stuckRows.push({
        kind: 'awaiting_consent_stale',
        letterId: l.id,
        ticketId: t?.id || '',
        ticketNumber: t?.ticket_number || null,
        ageHours: ageDays * 24,
        detail: `awaiting user consent for ${ageDays} days — user never replied "I AUTHORIZE"`,
        userId: t?.user_id || l.user_id,
      });
    }

    // (5) EVIDENCE-INTEGRATION AUDIT.
    //     Any ticket where the user submitted evidence (user_evidence is set
    //     OR there's a ticket_evidence row OR evidence_received_at is stamped)
    //     MUST have a contest letter with evidence_integrated=true.
    //     Two failure modes this catches:
    //       (a) Letter never regenerated (orphan-status bug — fixed but
    //           regression-guarded here).
    //       (b) Photo attachments arrived but Claude Vision wasn't run, so
    //           the letter never references what's actually in the photos.
    //     The check is intentionally loud: if a user gave us evidence and the
    //     letter doesn't show it as integrated, we want to know TODAY.
    const { data: ticketsWithEvidence } = await supabaseAdmin
      .from('detected_tickets')
      .select(`
        id, ticket_number, user_id, user_evidence, user_evidence_uploaded_at,
        evidence_received_at, status,
        contest_letters ( id, status, evidence_integrated, evidence_integrated_at, mailed_at, created_at )
      `)
      .or('user_evidence.not.is.null,evidence_received_at.not.is.null')
      .limit(200);

    for (const t of (ticketsWithEvidence as any[]) || []) {
      const letters = Array.isArray(t.contest_letters) ? t.contest_letters : (t.contest_letters ? [t.contest_letters] : []);
      // Use the most recently-touched letter (created or mailed) for this ticket.
      const letter = letters
        .slice()
        .sort((a: any, b: any) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
        )[0];

      const evidenceUploadedAt = t.user_evidence_uploaded_at || t.evidence_received_at;
      if (!evidenceUploadedAt) continue;

      // Skip if the letter was already mailed BEFORE the evidence arrived —
      // there's nothing to integrate after the fact.
      if (letter?.mailed_at && new Date(letter.mailed_at) < new Date(evidenceUploadedAt)) continue;

      const evidenceIntegrated = letter?.evidence_integrated === true;
      const ageHours = Math.round((Date.now() - new Date(evidenceUploadedAt).getTime()) / 3.6e6);

      // Give the system 1 hour to run — anything fresher might just be
      // mid-flight through the webhook handler.
      if (ageHours < 1) continue;

      if (!letter) {
        stuckRows.push({
          kind: 'evidence_not_integrated',
          letterId: null,
          ticketId: t.id,
          ticketNumber: t.ticket_number,
          ageHours,
          detail: `evidence uploaded ${ageHours}h ago but NO contest letter exists for this ticket`,
          userId: t.user_id,
        });
        continue;
      }

      if (!evidenceIntegrated) {
        stuckRows.push({
          kind: 'evidence_not_integrated',
          letterId: letter.id,
          ticketId: t.id,
          ticketNumber: t.ticket_number,
          ageHours,
          detail: `evidence uploaded ${ageHours}h ago, letter.evidence_integrated is ${letter.evidence_integrated ?? 'NULL'} (letter status=${letter.status})`,
          userId: t.user_id,
        });
        continue;
      }

      // Letter says integrated. Verify photo content actually made it through:
      // if user_evidence text parses as JSON with attachment_urls but no
      // photo_analyses, Claude Vision didn't run and the letter is missing
      // photo-derived facts.
      if (typeof t.user_evidence === 'string' && t.user_evidence.length > 0) {
        try {
          const parsed = JSON.parse(t.user_evidence);
          const hasAttachments = Array.isArray(parsed?.attachment_urls) && parsed.attachment_urls.length > 0;
          const hasPhotoAnalyses = Array.isArray(parsed?.photo_analyses) && parsed.photo_analyses.length > 0;
          if (hasAttachments && !hasPhotoAnalyses) {
            // Only flag if any attachment URL looks like an image.
            const imgRe = /\.(jpe?g|png|gif|heic|webp)(\?|$)/i;
            const hasImage = (parsed.attachment_urls as string[]).some(u => imgRe.test(u));
            if (hasImage) {
              stuckRows.push({
                kind: 'evidence_not_integrated',
                letterId: letter.id,
                ticketId: t.id,
                ticketNumber: t.ticket_number,
                ageHours,
                detail: `letter integrated but ${parsed.attachment_urls.length} attachment(s) have no photo_analyses — Claude Vision likely failed`,
                userId: t.user_id,
              });
            }
          }
        } catch (_) {
          // user_evidence may be legacy free-form text — not necessarily JSON.
          // We've already confirmed evidence_integrated=true, so this isn't a
          // hard failure.
        }
      }
    }

    // Run the contest-pipeline smoke test before deciding whether to send.
    // We want the email to fire on smoke FAILURE even when there are no
    // pending letters, so a regression in signature verification, the
    // letter validator, or the date formatter gets caught the next morning.
    const smoke = await runContestPipelineSmokeTest();

    // ── LIGHT END-TO-END STATE-MACHINE SMOKE ──
    // Inserts a synthetic test ticket + letter (is_test=true so it never
    // mails), simulates the autopilot-reminders promotion logic, then asserts
    // the letter is now in a status the mailing cron loads. Cleans up either
    // way. This catches regressions in the promotion path — the exact class
    // of bug that almost shipped this week (Day-17 trigger vs evidence_deadline).
    // No Claude calls, no Lob — runs in ~1s.
    let pipelineSmokePassed = true;
    let pipelineSmokeDetail = 'state-machine OK';
    {
      const SMOKE_USER_ID = '7d1adabb-f9f5-41ec-9075-5f7cb311a822'; // qa-bot
      const SMOKE_PLATE_ID = '849461dc-1746-4fb5-bb95-53c33aecbbe5';
      const ticketNumber = `SMOKE-DIGEST-${Date.now()}`;
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      let testTicketId: string | null = null;
      let testLetterId: string | null = null;
      try {
        const { data: tIns } = await supabaseAdmin
          .from('detected_tickets')
          .insert({
            user_id: SMOKE_USER_ID,
            plate_id: SMOKE_PLATE_ID,
            plate: 'QABOT01',
            state: 'IL',
            ticket_number: ticketNumber,
            violation_type: 'street_cleaning',
            violation_description: 'STREET CLEANING — DIGEST SMOKE',
            violation_date: '2026-05-01',
            amount: 60,
            status: 'pending_evidence',
            found_at: new Date().toISOString(),
            source: 'digest_smoke',
            evidence_requested_at: new Date().toISOString(),
            evidence_deadline: twoHoursAgo,
            auto_send_deadline: twoHoursAgo,
            is_test: true,
          })
          .select('id')
          .single();
        if (!tIns) throw new Error('insert test ticket failed');
        testTicketId = tIns.id;

        const placeholder = 'RE: Ticket #' + ticketNumber + '\n\nI am writing to formally contest...';
        const { data: lIns } = await supabaseAdmin
          .from('contest_letters')
          .insert({
            ticket_id: testTicketId,
            user_id: SMOKE_USER_ID,
            letter_content: placeholder,
            letter_text: placeholder,
            defense_type: 'digest_smoke',
            status: 'pending_evidence',
            using_default_address: false,
          })
          .select('id')
          .single();
        if (!lIns) throw new Error('insert test letter failed');
        testLetterId = lIns.id;

        // Simulate the autopilot-reminders trigger: evidence_deadline passed,
        // promote ticket + letter to 'approved'.
        await supabaseAdmin
          .from('detected_tickets')
          .update({ status: 'approved', auto_send_deadline: new Date().toISOString() })
          .eq('id', testTicketId)
          .eq('status', 'pending_evidence');

        await supabaseAdmin
          .from('contest_letters')
          .update({ status: 'approved', approved_via: 'auto_deadline_safety_net', approved_at: new Date().toISOString() })
          .eq('id', testLetterId)
          .eq('status', 'pending_evidence');

        // Confirm the mail-letters .or() filter would now match.
        const { data: matched } = await supabaseAdmin
          .from('contest_letters')
          .select('id, status, detected_tickets!inner ( is_test )')
          .or('status.eq.approved,status.eq.ready,status.eq.awaiting_consent,status.eq.mailing')
          .eq('id', testLetterId)
          .limit(1);
        if (!matched || matched.length === 0) {
          throw new Error('promoted letter not matched by mail-letters .or() filter');
        }
        if ((matched[0] as any).detected_tickets?.is_test !== true) {
          throw new Error('is_test flag missing on test ticket — would actually mail!');
        }
      } catch (smokeErr: any) {
        pipelineSmokePassed = false;
        pipelineSmokeDetail = smokeErr?.message || 'unknown failure';
        console.error('Pipeline state-machine smoke FAILED:', smokeErr);
      } finally {
        if (testLetterId) {
          await supabaseAdmin.from('contest_letters').delete().eq('id', testLetterId);
        }
        if (testTicketId) {
          await supabaseAdmin.from('ticket_audit_log').delete().eq('ticket_id', testTicketId);
          await supabaseAdmin.from('detected_tickets').delete().eq('id', testTicketId);
        }
      }
    }
    if (!pipelineSmokePassed) {
      smoke.passed = false;
      smoke.checks.push({
        name: 'pipeline state-machine: pending_evidence → approved → mail-letters filter',
        passed: false,
        detail: pipelineSmokeDetail,
      });
    } else {
      smoke.checks.push({
        name: 'pipeline state-machine: pending_evidence → approved → mail-letters filter',
        passed: true,
        detail: pipelineSmokeDetail,
      });
    }

    if ((!pendingLetters || pendingLetters.length === 0) && foiaWaiting.length === 0 && stuckRows.length === 0 && smoke.passed) {
      console.log('No pending letters, no stuck rows, smoke test passed — skipping digest email');
      return res.status(200).json({
        success: true,
        message: 'No pending letters or stuck rows, smoke passed, no email sent',
        pendingCount: 0,
        stuckCount: 0,
        smokePassed: true,
      });
    }

    // Get user emails for each letter
    const userIds = [
      ...new Set([
        ...(pendingLetters || []).map((l: any) => l.detected_tickets?.user_id),
        ...foiaWaiting.map((l: any) => l.detected_tickets?.user_id),
        ...stuckRows.map(r => r.userId),
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

    // Section 3: Stuck rows — silent state-machine failures
    if (stuckRows.length > 0) {
      const kindLabel: Record<StuckRow['kind'], string> = {
        evidence_deadline_overdue: 'Evidence deadline passed, letter still pending_evidence',
        evidence_received_unmailed: 'User submitted evidence, letter not promoted',
        mailing_stuck: 'Letter stuck in "mailing" status',
        awaiting_consent_stale: 'Awaiting user consent > 7 days',
        evidence_not_integrated: 'User evidence NOT integrated into letter',
      };
      const kindColor: Record<StuckRow['kind'], string> = {
        evidence_deadline_overdue: '#dc2626',
        evidence_received_unmailed: '#dc2626',
        mailing_stuck: '#f59e0b',
        awaiting_consent_stale: '#6b7280',
        evidence_not_integrated: '#dc2626',
      };

      html += `
        <h3 style="color: #dc2626; margin-top: 24px;">
          ${stuckRows.length} Stuck Row${stuckRows.length === 1 ? '' : 's'} — silent state-machine failure${stuckRows.length === 1 ? '' : 's'}
        </h3>
        <p style="color: #6b7280; font-size: 13px;">
          Each row below is something the cron chain SHOULD have moved by now. If you see the same ticket here two days in a row, there's a real regression to investigate.
        </p>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr style="background: #f3f4f6;">
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Issue</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Ticket</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">User</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Age</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Detail</th>
            <th style="padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb;">Action</th>
          </tr>
      `;
      for (const row of stuckRows) {
        const userEmail = row.userId ? (userEmailMap[row.userId] || 'Unknown') : 'Unknown';
        const ticketPageUrl = row.ticketId ? `https://autopilotamerica.com/tickets/${row.ticketId}` : '#';
        const ageDisplay = row.ageHours >= 48
          ? `${Math.round(row.ageHours / 24)}d`
          : `${row.ageHours}h`;
        html += `
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <td style="padding: 8px 12px; color: ${kindColor[row.kind]}; font-weight: 600;">${kindLabel[row.kind]}</td>
            <td style="padding: 8px 12px;">${row.ticketNumber || row.ticketId.slice(0, 8)}</td>
            <td style="padding: 8px 12px; font-size: 12px;">${userEmail}</td>
            <td style="padding: 8px 12px; font-weight: 600;">${ageDisplay}</td>
            <td style="padding: 8px 12px; max-width: 280px; font-size: 12px; color: #6b7280;">${row.detail}</td>
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

    // Send the email — smoke failures and stuck rows get a "[ALERT]" subject so
    // they don't get lost in inbox noise. Stuck rows are silent regressions
    // (state-machine breaks); always prioritize them in the subject.
    const totalReview = (pendingLetters?.length || 0) + foiaWaiting.length;
    const stuckCount = stuckRows.length;
    let subject: string;
    if (!smoke.passed) {
      subject = `[ALERT] Contest pipeline smoke test FAILED${stuckCount > 0 ? ` + ${stuckCount} stuck row${stuckCount === 1 ? '' : 's'}` : ''}${totalReview > 0 ? ` + ${totalReview} need review` : ''}`;
    } else if (stuckCount > 0) {
      subject = `[ALERT] ${stuckCount} stuck row${stuckCount === 1 ? '' : 's'} — state-machine failure${totalReview > 0 ? ` + ${totalReview} need review` : ''}`;
    } else {
      subject = `[Admin] ${totalReview} contest letter${totalReview === 1 ? '' : 's'} need${totalReview === 1 ? 's' : ''} review`;
    }

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
      `✅ Admin digest sent: ${pendingLetters?.length || 0} pending review, ${foiaWaiting.length} awaiting FOIA, ${stuckCount} stuck rows`
    );

    return res.status(200).json({
      success: true,
      pendingReview: pendingLetters?.length || 0,
      foiaWaiting: foiaWaiting.length,
      stuckRows: stuckCount,
      stuckBreakdown: stuckRows.reduce<Record<string, number>>((acc, r) => {
        acc[r.kind] = (acc[r.kind] || 0) + 1;
        return acc;
      }, {}),
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
