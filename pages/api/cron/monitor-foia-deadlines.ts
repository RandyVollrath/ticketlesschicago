/**
 * Cron: Monitor FOIA Response Deadlines
 *
 * Illinois FOIA law (5 ILCS 140) requires:
 *   - 5 business days to respond (from receipt)
 *   - Up to 5 additional business days if an extension is requested under Section 3(e)
 *
 * This cron checks for overdue FOIA requests and:
 *   1. Marks them as 'overdue' in notes (for admin visibility)
 *   2. Logs overdue requests so we can build non-response arguments for contest letters
 *
 * Schedule: Daily at 11 AM CT (16:00 UTC) — after FOIA send crons
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Count business days between two dates (excludes weekends, does NOT count holidays).
 * For Illinois FOIA purposes this is a reasonable approximation — the statute says
 * "business days" but the city doesn't consistently observe all holidays.
 */
function businessDaysBetween(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  current.setHours(0, 0, 0, 0);
  const endDate = new Date(end);
  endDate.setHours(0, 0, 0, 0);

  while (current < endDate) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return count;
}

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error('CRON_SECRET not configured — rejecting request');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting FOIA deadline monitoring...');

  const now = new Date();
  let overdueEvidence = 0;
  let overdueHistory = 0;
  let extensionOverdueEvidence = 0;
  let extensionOverdueHistory = 0;

  // ── Check ticket_foia_requests (evidence FOIAs) ──
  // Find 'sent' requests older than 5 business days
  const { data: sentEvidence, error: evidenceError } = await supabaseAdmin
    .from('ticket_foia_requests')
    .select('id, ticket_id, sent_at, reference_id, notes, status')
    .in('status', ['sent', 'extension_requested'])
    .not('sent_at', 'is', null)
    .order('sent_at', { ascending: true });

  if (evidenceError) {
    console.error('Failed to fetch sent evidence FOIAs:', evidenceError.message);
  }

  if (sentEvidence && sentEvidence.length > 0) {
    for (const req of sentEvidence as any[]) {
      const sentDate = new Date(req.sent_at);
      const bDays = businessDaysBetween(sentDate, now);

      const isExtended = req.status === 'extension_requested';
      const deadline = isExtended ? 10 : 5; // 5 base + 5 extension

      if (bDays > deadline) {
        const alreadyMarked = req.notes?.includes('OVERDUE');
        if (!alreadyMarked) {
          const overdueNote = isExtended
            ? `OVERDUE: ${bDays} business days since sent (10-day extended deadline exceeded). Ref: ${req.reference_id}`
            : `OVERDUE: ${bDays} business days since sent (5-day deadline exceeded). Ref: ${req.reference_id}`;

          await supabaseAdmin
            .from('ticket_foia_requests')
            .update({
              notes: overdueNote,
              status: 'overdue',
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', req.id);

          if (isExtended) {
            extensionOverdueEvidence++;
          } else {
            overdueEvidence++;
          }
          console.log(`  Evidence FOIA ${req.reference_id} (ticket ${req.ticket_id}): ${bDays} business days, deadline=${deadline} — OVERDUE`);
        }
      }
    }
  }

  // ── Check foia_history_requests (plate history FOIAs) ──
  const { data: sentHistory, error: historyError } = await supabaseAdmin
    .from('foia_history_requests')
    .select('id, license_plate, license_state, foia_sent_at, reference_id, notes, status')
    .in('status', ['sent', 'extension_requested'])
    .not('foia_sent_at', 'is', null)
    .order('foia_sent_at', { ascending: true });

  if (historyError) {
    console.error('Failed to fetch sent history FOIAs:', historyError.message);
  }

  if (sentHistory && sentHistory.length > 0) {
    for (const req of sentHistory as any[]) {
      const sentDate = new Date(req.foia_sent_at);
      const bDays = businessDaysBetween(sentDate, now);

      const isExtended = req.status === 'extension_requested';
      const deadline = isExtended ? 10 : 5;

      if (bDays > deadline) {
        const alreadyMarked = req.notes?.includes('OVERDUE');
        if (!alreadyMarked) {
          const overdueNote = isExtended
            ? `OVERDUE: ${bDays} business days since sent (10-day extended deadline exceeded). Ref: ${req.reference_id}`
            : `OVERDUE: ${bDays} business days since sent (5-day deadline exceeded). Ref: ${req.reference_id}`;

          await supabaseAdmin
            .from('foia_history_requests')
            .update({
              notes: overdueNote,
              status: 'overdue',
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', req.id);

          if (isExtended) {
            extensionOverdueHistory++;
          } else {
            overdueHistory++;
          }
          console.log(`  History FOIA ${req.reference_id} (${req.license_state} ${req.license_plate}): ${bDays} business days, deadline=${deadline} — OVERDUE`);
        }
      }
    }
  }

  // ── Auto-send follow-up for overdue FOIAs (6+ business days, no extension) ──
  // Illinois FOIA law requires response within 5 business days.
  // If no response, we send a polite follow-up citing 5 ILCS 140/11(d).
  //
  // IMPORTANT: Before sending any follow-up, check if the city already responded.
  // The Resend incoming-email webhook may have failed to process the response,
  // leaving the DB status stale while the response sits in our inbox.
  let followUpsSent = 0;
  let followUpsSkipped = 0;
  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (RESEND_API_KEY) {
    // ── Helper: Check if a specific FOIA reference ID has a response in our inbox ──
    // Paginates through Resend received emails looking for the reference ID in the subject.
    // Stops as soon as it finds a match or exhausts the inbox. Max 5 pages to stay within
    // the 60s function timeout (each page = 100 emails, so checks up to 500 most recent).
    async function hasResponseInInbox(referenceId: string): Promise<boolean> {
      const MAX_PAGES = 5;
      let cursor: string | undefined;

      for (let page = 0; page < MAX_PAGES; page++) {
        const url = cursor
          ? `https://api.resend.com/emails/receiving?limit=100&before=${cursor}`
          : 'https://api.resend.com/emails/receiving?limit=100';

        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}` },
        });
        if (!res.ok) return false;

        const data = await res.json();
        const emails = data.data || data || [];
        if (!Array.isArray(emails) || emails.length === 0) break;

        for (const email of emails) {
          if ((email.subject || '').includes(referenceId)) {
            return true;
          }
        }

        // Use last email ID as cursor for next page
        cursor = emails[emails.length - 1]?.id;
        if (!cursor) break;
      }

      return false;
    }

    // ── Helper: Check if a reference ID exists in unmatched responses ──
    // (webhook fired but 4-layer matching failed)
    async function hasUnmatchedResponse(referenceId: string): Promise<boolean> {
      const { data } = await supabaseAdmin
        .from('foia_unmatched_responses' as any)
        .select('id')
        .eq('extracted_reference_id', referenceId)
        .limit(1);
      return (data && data.length > 0) || false;
    }

    // ── Helper: Combined check — DB first (cheap), then inbox (API calls) ──
    async function responseAlreadyReceived(referenceId: string): Promise<boolean> {
      try {
        if (await hasUnmatchedResponse(referenceId)) return true;
        if (await hasResponseInInbox(referenceId)) return true;
      } catch (err: any) {
        console.warn(`  Response check failed for ${referenceId}: ${err.message}`);
      }
      return false;
    }

    // Re-query for recently-marked overdue evidence FOIAs that haven't been followed up yet
    const { data: overdueForFollowUp } = await supabaseAdmin
      .from('ticket_foia_requests')
      .select('id, ticket_id, reference_id, sent_at, notes, request_payload')
      .eq('status', 'overdue')
      .order('sent_at', { ascending: true })
      .limit(10); // Max 10 follow-ups per day to avoid flooding

    for (const req of (overdueForFollowUp || []) as any[]) {
      // Skip if already followed up
      if (req.notes?.includes('FOLLOW-UP SENT')) continue;

      // Skip if we already received a response (DB check + inbox scan for this specific FOIA)
      if (req.reference_id && await responseAlreadyReceived(req.reference_id)) {
        console.log(`  Skipping follow-up for ${req.reference_id} — response found in inbox or unmatched queue`);
        followUpsSkipped++;
        await supabaseAdmin
          .from('ticket_foia_requests')
          .update({
            status: 'fulfilled',
            notes: `${req.notes || ''}\nRESPONSE DETECTED IN INBOX — follow-up suppressed ${new Date().toISOString()}`,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', req.id);
        continue;
      }

      const bDays = businessDaysBetween(new Date(req.sent_at), now);
      // Only follow up after 6 business days (give 1 day grace after 5-day deadline)
      if (bDays < 6) continue;

      const ticketNumber = req.request_payload?.ticket_number || 'Unknown';
      const requesterName = req.request_payload?.requester_name || 'Autopilot America';

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'Autopilot America <foia@autopilotamerica.com>',
            to: 'DOFfoia@cityofchicago.org',
            subject: `Follow-Up: FOIA Request ${req.reference_id} — ${bDays} Business Days Without Response`,
            text: `Dear FOIA Officer,

This is a follow-up regarding my Freedom of Information Act request submitted on ${new Date(req.sent_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.

Reference ID: ${req.reference_id}
Ticket Number: ${ticketNumber}
Requester: ${requesterName}

Per 5 ILCS 140/3, the City is required to respond within five (5) business days of receipt. It has now been ${bDays} business days since this request was submitted, and no response or extension notice has been received.

Under 5 ILCS 140/11(d), failure to respond within the statutory timeframe constitutes a denial of the request, and the requester may seek judicial review.

I respectfully request that responsive records be produced promptly.

Sincerely,
${requesterName}
On behalf of Autopilot America
foia@autopilotamerica.com`,
          }),
        });

        if (emailRes.ok) {
          followUpsSent++;
          console.log(`  Follow-up sent for ${req.reference_id} (${bDays} business days overdue)`);

          // Update notes so we don't follow up again
          await supabaseAdmin
            .from('ticket_foia_requests')
            .update({
              notes: `${req.notes || ''}\nFOLLOW-UP SENT: ${new Date().toISOString()} (${bDays} business days since original request)`,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', req.id);
        }
      } catch (err: any) {
        console.error(`  Follow-up email failed for ${req.reference_id}: ${err.message}`);
      }
    }

    // Same for history FOIAs
    const { data: overdueHistoryFollowUp } = await supabaseAdmin
      .from('foia_history_requests')
      .select('id, license_plate, license_state, reference_id, foia_sent_at, notes, name, email')
      .eq('status', 'overdue')
      .order('foia_sent_at', { ascending: true })
      .limit(10);

    for (const req of (overdueHistoryFollowUp || []) as any[]) {
      if (req.notes?.includes('FOLLOW-UP SENT')) continue;

      // Skip if we already received a response (DB check + inbox scan for this specific FOIA)
      if (req.reference_id && await responseAlreadyReceived(req.reference_id)) {
        console.log(`  Skipping follow-up for history ${req.reference_id} — response found in inbox or unmatched queue`);
        followUpsSkipped++;
        await supabaseAdmin
          .from('foia_history_requests')
          .update({
            status: 'fulfilled',
            notes: `${req.notes || ''}\nRESPONSE DETECTED IN INBOX — follow-up suppressed ${new Date().toISOString()}`,
            updated_at: new Date().toISOString(),
          } as any)
          .eq('id', req.id);
        continue;
      }

      const bDays = businessDaysBetween(new Date(req.foia_sent_at), now);
      if (bDays < 6) continue;

      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: 'Autopilot America <foia@autopilotamerica.com>',
            to: 'DOFfoia@cityofchicago.org',
            subject: `Follow-Up: FOIA Request ${req.reference_id} — ${bDays} Business Days Without Response`,
            text: `Dear FOIA Officer,

This is a follow-up regarding my Freedom of Information Act request submitted on ${new Date(req.foia_sent_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.

Reference ID: ${req.reference_id}
License Plate: ${req.license_state} ${req.license_plate}
Requester: ${req.name || 'Autopilot America'}

Per 5 ILCS 140/3, the City is required to respond within five (5) business days of receipt. It has now been ${bDays} business days since this request was submitted, and no response or extension notice has been received.

Under 5 ILCS 140/11(d), failure to respond within the statutory timeframe constitutes a denial of the request, and the requester may seek judicial review.

I respectfully request that responsive records be produced promptly.

Sincerely,
${req.name || 'Autopilot America'}
foia@autopilotamerica.com`,
          }),
        });

        if (emailRes.ok) {
          followUpsSent++;
          console.log(`  Follow-up sent for history FOIA ${req.reference_id} (${bDays} business days overdue)`);

          await supabaseAdmin
            .from('foia_history_requests')
            .update({
              notes: `${req.notes || ''}\nFOLLOW-UP SENT: ${new Date().toISOString()} (${bDays} business days since original request)`,
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', req.id);
        }
      } catch (err: any) {
        console.error(`  Follow-up email failed for history ${req.reference_id}: ${err.message}`);
      }
    }
  }

  const summary = {
    overdueEvidence,
    overdueHistory,
    extensionOverdueEvidence,
    extensionOverdueHistory,
    totalOverdue: overdueEvidence + overdueHistory + extensionOverdueEvidence + extensionOverdueHistory,
    followUpsSent,
    followUpsSkipped,
  };

  console.log('FOIA deadline monitoring complete:', summary);
  return res.status(200).json(summary);
}
