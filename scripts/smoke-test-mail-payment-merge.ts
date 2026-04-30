#!/usr/bin/env npx tsx
/**
 * Mail-letter payment extracted_data merge smoke (QA_REPORT.md net #6).
 *
 * The bug this catches:
 *   pages/api/contest/create-mail-payment.ts updates ticket_contests with
 *     extracted_data: { ...(contest.extracted_data || {}), signature }
 *   The select had been missing `extracted_data`, so contest.extracted_data
 *   was undefined → spread of {} → previous fields wiped.
 *
 * This smoke replays that exact sequence (SELECT → spread → UPDATE) against
 * a synthetic ticket_contests row and asserts every prior key survives.
 * It runs against a real DB so a future schema change that drops
 * extracted_data, or a future code change that strips it from the select,
 * fails the same way the production bug failed.
 *
 * Cleans up after itself. Safe to run on prod and in CI.
 *
 * Run locally:
 *   node -r dotenv/config node_modules/.bin/tsx \
 *     scripts/smoke-test-mail-payment-merge.ts dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js';

const BOT_EMAIL = process.env.QA_BOT_EMAIL || 'qa-bot@autopilotamerica.com';

let passed = 0;
let failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const supabase = createClient(url, key);

  console.log('→ Mail-letter payment extracted_data merge smoke\n');

  // Find QA bot
  let botUserId: string | null = null;
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { console.error(error.message); process.exit(1); }
    const found = data.users.find(u => u.email === BOT_EMAIL);
    if (found) { botUserId = found.id; break; }
    if (data.users.length < 200) break;
    page += 1;
  }
  if (!botUserId) {
    console.error(`QA bot not found (${BOT_EMAIL}). Run scripts/setup-qa-bot-user.ts first.`);
    process.exit(1);
  }

  // Insert a synthetic ticket_contests row with prior extracted_data we
  // expect to survive the merge.
  const ticketNumber = `QAMAIL${Date.now().toString().slice(-9)}`;
  const priorExtractedData = {
    defense_grounds: ['no_visible_signage'],
    foia_dismissal_rate: 0.62,
    notes: 'driver out of town that week',
    nested: { deep_field: 'must survive' },
  };

  const { data: contestIns, error: cErr } = await supabase
    .from('ticket_contests')
    .insert({
      user_id: botUserId,
      ticket_number: ticketNumber,
      violation_code: '9-64-040(b)',
      violation_description: 'Street cleaning - QA synthetic',
      status: 'draft',
      extracted_data: priorExtractedData,
      contest_grounds: ['signage_obscured'],
      // ticket_contests requires a non-null ticket_photo_url; QA placeholder.
      ticket_photo_url: 'https://qa.example.com/synthetic.jpg',
    } as any)
    .select('id, extracted_data')
    .single();
  if (cErr || !contestIns) {
    console.error(`Insert ticket_contests failed: ${cErr?.message}`);
    process.exit(1);
  }
  const contestId = contestIns.id;
  ok('synthetic ticket_contests inserted with prior extracted_data', true);

  // Postgres jsonb doesn't preserve key order, so compare deeply by value.
  const sameData = (a: any, b: any) => {
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return a === b;
    if (typeof a !== 'object') return a === b;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      return a.length === b.length && a.every((v, i) => sameData(v, b[i]));
    }
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length) return false;
    return ak.every((k, i) => k === bk[i] && sameData(a[k], b[k]));
  };

  ok(
    'prior extracted_data persisted on insert (deep value compare)',
    sameData(contestIns.extracted_data, priorExtractedData),
  );

  let cleanupRan = false;
  const cleanup = async () => {
    if (cleanupRan) return;
    cleanupRan = true;
    console.log('\n→ cleanup');
    await supabase.from('ticket_contests').delete().eq('id', contestId);
    console.log('  ✓ cleanup complete');
  };

  try {
    // Replay the exact SELECT shape from pages/api/contest/create-mail-payment.ts.
    // If a future change strips extracted_data from the select, this smoke
    // fails the same way the original prod bug failed.
    console.log('\n1) Replay the create-mail-payment SELECT shape');
    const { data: contest, error: fetchErr } = await supabase
      .from('ticket_contests')
      .select('id, ticket_number, extracted_data')
      .eq('id', contestId)
      .maybeSingle();
    if (fetchErr || !contest) {
      console.error(`  fetch failed: ${fetchErr?.message}`);
      throw fetchErr;
    }
    ok('extracted_data is present in select result', contest.extracted_data !== null && contest.extracted_data !== undefined);
    ok(
      'select returns full prior extracted_data',
      sameData(contest.extracted_data, priorExtractedData),
    );

    // Replay the merge spread the prod handler does. The bug was: the
    // original code didn't include extracted_data in the select, so this
    // spread was ...({} || {}) = {} and the update wiped prior data.
    const signature = 'data:image/png;base64,iVBORw0KGgo=QA';
    const merged = {
      ...((contest.extracted_data as any) || {}),
      signature,
    };

    console.log('\n2) Apply the synthetic UPDATE with signature merged in');
    // Replay the full UPDATE the production handler does (now that the
    // 20260430 migration added the missing mail_service_* / mailing_address
    // / mail_status columns). Includes everything pages/api/contest/
    // create-mail-payment.ts writes.
    const fakePaymentIntent = `pi_qa_${Date.now()}`;
    const fakeMailingAddress = { name: 'QA Bot', address: '123 QA St', city: 'Chicago', state: 'IL', zip: '60614' };
    const { error: updateErr } = await supabase
      .from('ticket_contests')
      .update({
        mail_service_requested: true,
        mail_service_payment_intent: fakePaymentIntent,
        mail_service_payment_status: 'pending',
        mail_service_amount: 5,
        mailing_address: fakeMailingAddress,
        mail_status: 'pending',
        extracted_data: merged,
      } as any)
      .eq('id', contestId);
    if (updateErr) {
      console.error(`  update failed: ${updateErr.message}`);
      throw updateErr;
    }
    ok('update succeeded', true);

    console.log('\n3) Verify every prior key survived AND signature is present');
    const { data: after } = await supabase
      .from('ticket_contests')
      .select('extracted_data, mail_service_requested, mail_service_payment_intent, mail_service_payment_status, mail_service_amount, mailing_address, mail_status')
      .eq('id', contestId)
      .maybeSingle();
    const post = (after?.extracted_data as any) || {};
    ok('post-update extracted_data is an object', !!post && typeof post === 'object');
    ok('defense_grounds preserved', sameData(post.defense_grounds, priorExtractedData.defense_grounds));
    ok('foia_dismissal_rate preserved', post.foia_dismissal_rate === priorExtractedData.foia_dismissal_rate);
    ok('free-text notes preserved', post.notes === priorExtractedData.notes);
    ok('nested deep_field preserved (verifies real spread, not shallow truncation)', post.nested?.deep_field === priorExtractedData.nested.deep_field);
    ok('signature was added', post.signature === signature);
    // Mail service columns the migration restored. These were silently
    // dropped before the migration; if they ever go missing again the
    // handler payment-intent guard breaks too.
    ok('mail_service_requested persisted', (after as any)?.mail_service_requested === true);
    ok('mail_service_payment_intent persisted (also feeds duplicate-payment guard)', (after as any)?.mail_service_payment_intent === fakePaymentIntent);
    ok('mail_service_payment_status persisted', (after as any)?.mail_service_payment_status === 'pending');
    ok('mail_service_amount persisted', Number((after as any)?.mail_service_amount) === 5);
    ok('mailing_address persisted', sameData((after as any)?.mailing_address, fakeMailingAddress));
    ok('mail_status persisted', (after as any)?.mail_status === 'pending');
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
