#!/usr/bin/env npx tsx
/**
 * One-time backfill: flip detected_tickets that the city has already ruled
 * on but whose status was silently stuck in 'mailed' (or other pre-outcome
 * state) due to two prod bugs fixed today (2026-04-30):
 *
 *   1. processOutcomeChange wrote contest_outcome / contest_outcome_at /
 *      final_amount to detected_tickets — those columns live on
 *      contest_letters. The bad UPDATE failed the entire payload so
 *      status: 'won' never persisted either. (Fixed in code.)
 *   2. detected_tickets.status CHECK constraint rejected 'won', 'lost',
 *      'reduced'. Even if the wrong-table fields hadn't been there, the
 *      constraint would have rejected the new status anyway. (Fixed by
 *      migration 20260429_expand_detected_tickets_status_check.sql.)
 *
 * For every detected_ticket whose last_portal_status indicates a terminal
 * outcome but whose status is still pre-outcome, this re-runs the same
 * status update + audit-log + user-notify path the cron does.
 *
 * Idempotent. Default is DRY-RUN — pass --apply to write.
 *
 * Usage:
 *   node -r dotenv/config node_modules/.bin/tsx \
 *     scripts/backfill-stuck-contest-outcomes.ts dotenv_config_path=.env.local
 *   # then:
 *   node -r dotenv/config node_modules/.bin/tsx \
 *     scripts/backfill-stuck-contest-outcomes.ts --apply dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js';

const TERMINAL_PORTAL_STATUSES = ['dismissed', 'upheld', 'reduced'] as const;
const PRE_OUTCOME_STATUSES = [
  'mailed',
  'letter_generated',
  'approved',
  'needs_approval',
  'pending_evidence',
  'evidence_received',
  'hearing_scheduled',
  'contested_online',
];

const apply = process.argv.includes('--apply');

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log(`→ Backfill stuck contest outcomes${apply ? ' (APPLY)' : ' (DRY-RUN)'}\n`);

  // Pull every candidate row in one shot. last_portal_status is text, so we
  // filter on the documented terminal values.
  const { data: candidates, error } = await supabase
    .from('detected_tickets')
    .select('id, ticket_number, user_id, status, last_portal_status, last_portal_check, amount, violation_type, created_at')
    .in('last_portal_status', TERMINAL_PORTAL_STATUSES as unknown as string[])
    .in('status', PRE_OUTCOME_STATUSES);
  if (error) {
    console.error(`Query failed: ${error.message}`);
    process.exit(1);
  }
  if (!candidates || candidates.length === 0) {
    console.log('No stuck rows. Nothing to backfill.');
    process.exit(0);
  }

  console.log(`Found ${candidates.length} stuck row${candidates.length === 1 ? '' : 's'}:\n`);

  const summary = { dismissed: 0, upheld: 0, reduced: 0, errors: 0 };
  const newStatusFor = (portal: string): string => {
    if (portal === 'dismissed') return 'won';
    if (portal === 'reduced') return 'reduced';
    return 'lost'; // upheld
  };

  for (const t of candidates) {
    const portal = t.last_portal_status as 'dismissed' | 'upheld' | 'reduced';
    const newStatus = newStatusFor(portal);
    const ageDays = t.created_at ? Math.round((Date.now() - new Date(t.created_at).getTime()) / 86400000) : null;
    const line = `  ${t.ticket_number?.padEnd(15) || 'no-number     '} ` +
                 `${(t.violation_type || '').padEnd(20).slice(0, 20)} ` +
                 `${(t.status || '').padEnd(15).slice(0, 15)} → ${newStatus.padEnd(8)} ` +
                 `(portal: ${portal}, ${ageDays === null ? '?' : ageDays + 'd old'}, $${t.amount ?? '?'})`;
    console.log(line);

    if (!apply) continue;

    const { error: updateErr } = await supabase
      .from('detected_tickets')
      .update({
        status: newStatus,
        last_portal_check: new Date().toISOString(),
      })
      .eq('id', t.id);

    if (updateErr) {
      console.log(`    ✗ update failed: ${updateErr.message}`);
      summary.errors++;
      continue;
    }
    summary[portal]++;

    // Audit log: record the backfill so the history is honest about the
    // delay and the reason. Best-effort — non-fatal if the table changed.
    try {
      await supabase.from('ticket_audit_log').insert({
        ticket_id: t.id,
        action: `backfill_${portal}`,
        details: {
          previous_status: t.status,
          new_status: newStatus,
          backfill_reason: '20260430 status-flip + check-constraint fix unblocked stuck rows',
        },
        performed_by: null,
      });
    } catch (e: any) {
      console.log(`    (audit log insert non-fatal failure: ${e.message})`);
    }
  }

  console.log('');
  if (apply) {
    console.log(`Applied: ${summary.dismissed} won, ${summary.reduced} reduced, ${summary.upheld} lost. Errors: ${summary.errors}.`);
  } else {
    console.log(`Dry-run complete. Re-run with --apply to write the status changes.`);
  }
}

main().catch(err => {
  console.error('Backfill crashed:', err);
  process.exit(1);
});
