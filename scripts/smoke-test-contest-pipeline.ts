#!/usr/bin/env npx tsx
/**
 * Synthetic end-to-end monitor for the contest pipeline (QA_REPORT.md net #3).
 *
 * Pretends to be a real customer who got a ticket that the city later
 * dismissed. Runs the actual outcome-detection logic in lib/contest-outcome-tracker
 * and asserts the database side effects we promise customers:
 *   1. Ticket status flips to "won"
 *   2. contest_outcome set to "dismissed"
 *   3. final_amount written
 *   4. ticket_audit_log row recorded
 *
 * Cleans up everything it created. Designed to be safe to run on prod and in
 * CI on a daily schedule.
 *
 * Run locally:
 *   node -r dotenv/config node_modules/.bin/tsx \
 *     scripts/smoke-test-contest-pipeline.ts dotenv_config_path=.env.local
 *
 * Run in CI: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
 *            QA_BOT_EMAIL must be set.
 */

import { createClient } from '@supabase/supabase-js';
import {
  detectOutcomeChange,
  processOutcomeChange,
} from '../lib/contest-outcome-tracker';

const BOT_EMAIL = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log(`→ Synthetic contest pipeline smoke as ${BOT_EMAIL}\n`);

  // Find or fail-fast on the QA bot user
  let botUserId: string | null = null;
  {
    let page = 1;
    for (;;) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error) {
        console.error(`listUsers failed: ${error.message}`);
        process.exit(1);
      }
      const found = data.users.find(u => u.email === BOT_EMAIL);
      if (found) { botUserId = found.id; break; }
      if (data.users.length < 200) break;
      page += 1;
    }
  }
  if (!botUserId) {
    console.error(`QA bot user not found (${BOT_EMAIL}). Run scripts/setup-qa-bot-user.ts first.`);
    process.exit(1);
  }

  // Stable identifiers for this run so cleanup is targeted even if the run
  // crashes mid-flight. Time-based + random suffix.
  const runTag = `qa-pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const ticketNumber = `QA${Date.now().toString().slice(-9)}`;
  const plate = 'QABOT01';
  const originalAmount = 80;

  console.log('1) Insert synthetic plate, ticket, and portal result');

  // detected_tickets requires a plate_id FK to monitored_plates. Find an
  // existing row for the bot, or insert a fresh one. (No unique constraint
  // on (user_id, plate) so we look-up first instead of upsert.)
  let plateId: string;
  const { data: existingPlates } = await supabase
    .from('monitored_plates')
    .select('id')
    .eq('user_id', botUserId)
    .eq('plate', plate)
    .limit(1);
  if (existingPlates && existingPlates.length > 0) {
    plateId = existingPlates[0].id;
  } else {
    const { data: plateRow, error: plateErr } = await supabase
      .from('monitored_plates')
      .insert({
        user_id: botUserId,
        plate,
        state: 'IL',
        status: 'active',
        is_leased_or_company: false,
      } as any)
      .select('id, plate')
      .single();
    if (plateErr || !plateRow) {
      console.error(`Insert monitored_plates failed: ${plateErr?.message}`);
      process.exit(1);
    }
    plateId = plateRow.id;
  }
  ok('synthetic monitored_plate ready', true);

  // Synthetic detected_ticket. is_test: true so any cron/dashboard that
  // filters test rows ignores it.
  const { data: ticketIns, error: tErr } = await supabase
    .from('detected_tickets')
    .insert({
      user_id: botUserId,
      plate_id: plateId,
      ticket_number: ticketNumber,
      violation_type: 'street_cleaning',
      violation_code: '9-64-040(b)',
      amount: originalAmount,
      plate,
      state: 'IL',
      status: 'mailed',
      location: '1237 W Fullerton Ave',
      officer_badge: 'QA-9999',
      is_test: true,
      created_at: new Date().toISOString(),
      // Tag in last_portal_status so cleanup can find it deterministically.
      last_portal_status: runTag,
    } as any)
    .select('id, ticket_number')
    .single();
  if (tErr || !ticketIns) {
    console.error(`Insert detected_ticket failed: ${tErr?.message}`);
    process.exit(1);
  }
  const ticketId = ticketIns.id;
  ok('synthetic detected_ticket inserted', true);

  // Make sure to clean up no matter what happens below.
  let cleanupRan = false;
  const cleanup = async () => {
    if (cleanupRan) return;
    cleanupRan = true;
    console.log('\n→ cleanup');
    await supabase.from('contest_outcomes').delete().eq('ticket_id', ticketId);
    await supabase.from('ticket_audit_log').delete().eq('ticket_id', ticketId);
    await supabase.from('notification_logs').delete().eq('user_id', botUserId).gte('sent_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
    await supabase.from('portal_check_results').delete().eq('ticket_number', ticketNumber);
    await supabase.from('detected_tickets').delete().eq('id', ticketId);
    console.log('  ✓ cleanup complete');
  };
  process.on('uncaughtException', () => cleanup().finally(() => process.exit(1)));

  try {
    // Synthetic portal result that the contest-outcome-tracker would read.
    const { error: pErr } = await supabase
      .from('portal_check_results')
      .insert({
        ticket_number: ticketNumber,
        plate,
        state: 'IL',
        ticket_queue: 'Closed',
        hearing_disposition: 'Not Liable',
        current_amount_due: 0,
        original_amount: originalAmount,
        checked_at: new Date().toISOString(),
      } as any);
    if (pErr) {
      console.error(`Insert portal_check_results failed: ${pErr.message}`);
      throw pErr;
    }
    ok('synthetic portal_check_results inserted with "Not Liable" disposition', true);

    console.log('\n2) Run outcome detection logic against synthetic data');

    const change = detectOutcomeChange(
      {
        id: ticketId,
        ticket_number: ticketNumber,
        user_id: botUserId,
        violation_type: 'street_cleaning',
        violation_code: '9-64-040(b)',
        amount: originalAmount,
        officer_badge: 'QA-9999',
        location: '1237 W Fullerton Ave',
        status: 'mailed',
        plate,
        state: 'IL',
        last_portal_status: runTag,
        last_portal_check: null,
      },
      {
        ticket_queue: 'Closed',
        hearing_disposition: 'Not Liable',
        current_amount_due: 0,
        original_amount: originalAmount,
      },
    );
    ok('detectOutcomeChange recognized "Not Liable" as dismissed', change.outcome === 'dismissed', `got ${change.outcome}`);

    if (change.outcome !== 'dismissed') {
      throw new Error('Outcome detection regression — would silently miss real wins');
    }

    console.log('\n3) Apply the outcome (writes status, audit log, notifies user)');

    await processOutcomeChange(
      supabase as any,
      {
        id: ticketId,
        ticket_number: ticketNumber,
        user_id: botUserId,
        violation_type: 'street_cleaning',
        violation_code: '9-64-040(b)',
        amount: originalAmount,
        officer_badge: 'QA-9999',
        location: '1237 W Fullerton Ave',
        status: 'mailed',
        plate,
        state: 'IL',
        last_portal_status: null,
        last_portal_check: null,
      },
      'dismissed',
      change.details,
      change.finalAmount ?? 0,
    );

    console.log('\n4) Verify the database side effects');

    // detected_tickets only carries status/last_portal_status. The full
    // contest_outcome / final_amount live on contest_outcomes (and
    // contest_letters when one was generated).
    const { data: updated } = await supabase
      .from('detected_tickets')
      .select('status, last_portal_status, last_portal_check')
      .eq('id', ticketId)
      .maybeSingle();
    ok('ticket status flipped to "won"', updated?.status === 'won', `got ${updated?.status}`);
    ok('last_portal_status set to "dismissed"', updated?.last_portal_status === 'dismissed', `got ${updated?.last_portal_status}`);
    ok('last_portal_check populated', !!updated?.last_portal_check);

    const { data: auditRows } = await supabase
      .from('ticket_audit_log')
      .select('action, details')
      .eq('ticket_id', ticketId);
    const dismissalAudit = auditRows?.find((r: any) => r.action === 'contest_dismissed');
    ok('ticket_audit_log row written for contest_dismissed', !!dismissalAudit);

    const { data: outcomeRows } = await supabase
      .from('contest_outcomes')
      .select('outcome, final_amount, original_amount')
      .eq('ticket_id', ticketId);
    ok('contest_outcomes row written', (outcomeRows?.length ?? 0) > 0);
    if (outcomeRows && outcomeRows[0]) {
      ok('contest_outcomes outcome = dismissed', outcomeRows[0].outcome === 'dismissed');
      ok('contest_outcomes final_amount = 0', outcomeRows[0].final_amount === 0);
      ok('contest_outcomes original_amount = 80', outcomeRows[0].original_amount === originalAmount);
    }

    // notification_logs — win email logs to category=contest_outcome,
    // notification_type=email. (Push only logs if the user has an FCM
    // device id, which the QA bot doesn't have.)
    const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const { data: notifyRows } = await supabase
      .from('notification_logs')
      .select('category, status, notification_type')
      .eq('user_id', botUserId)
      .eq('category', 'contest_outcome')
      .gte('sent_at', since);
    ok(
      'notification_logs row recorded for contest_outcome (email)',
      !!notifyRows?.find((r: any) => r.notification_type === 'email' && r.status === 'sent'),
      `got ${notifyRows?.length} rows: ${JSON.stringify(notifyRows)}`,
    );
  } finally {
    await cleanup();
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
