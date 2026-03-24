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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? (authHeader === `Bearer ${secret}`) : false);

  if (!isAuthorized) {
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
    .select('id, ticket_number, foia_sent_at, reference_id, notes, status')
    .in('status', ['sent', 'extension_requested'])
    .not('foia_sent_at', 'is', null)
    .order('foia_sent_at', { ascending: true });

  if (evidenceError) {
    console.error('Failed to fetch sent evidence FOIAs:', evidenceError.message);
  }

  if (sentEvidence && sentEvidence.length > 0) {
    for (const req of sentEvidence as any[]) {
      const sentDate = new Date(req.foia_sent_at);
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
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', req.id);

          if (isExtended) {
            extensionOverdueEvidence++;
          } else {
            overdueEvidence++;
          }
          console.log(`  Evidence FOIA ${req.reference_id} (ticket ${req.ticket_number}): ${bDays} business days, deadline=${deadline} — OVERDUE`);
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

  const summary = {
    overdueEvidence,
    overdueHistory,
    extensionOverdueEvidence,
    extensionOverdueHistory,
    totalOverdue: overdueEvidence + overdueHistory + extensionOverdueEvidence + extensionOverdueHistory,
  };

  console.log('FOIA deadline monitoring complete:', summary);
  return res.status(200).json(summary);
}
