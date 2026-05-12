#!/usr/bin/env tsx
/**
 * Smoke test for the new one-tap-confirm + correction flow added to the
 * ground-truth banner on HomeScreen. The mobile UI emits these
 * `feedback_source` strings to /api/mobile/parking-feedback:
 *
 *   user_hero_confirm            — Yes-tap on the prominent banner
 *   user_hero_false_positive     — "Not parked" tap
 *   user_hero_wrong_address_open — "Wrong address" tap (No, opens modal)
 *   user_wrong_street_open_map   — "Drop a pin on the map" tap inside modal
 *   user_wrong_street_alternate_tap | _typed | _autocomplete | _pin_drag
 *                                — Final correction submission paths
 *
 * This test:
 *   1. Inserts a synthetic parking_diagnostics row owned by Randy
 *   2. Mints a session token for Randy via supabase admin generateLink
 *   3. POSTs each feedback_source against /api/mobile/parking-feedback
 *   4. Reads back the row, asserts user_confirmed_*, street_correct, and
 *      native_meta.feedback_source / corrected_address landed correctly
 *   5. Cleans up the synthetic row
 *
 * Exit code 0 = full round-trip works. Non-zero = something didn't persist.
 *
 * Run: npx tsx scripts/smoke-test-parking-feedback.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const HOST = process.env.SMOKE_HOST || 'https://www.autopilotamerica.com';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('[smoke] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

let cachedToken: string | null = null;
async function getRandyAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const randy = users?.users.find(u => u.email === 'randyvollrath@gmail.com');
  if (!randy) throw new Error('randyvollrath@gmail.com not found');
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: randy.email! });
  if (error) throw error;
  const tokenHash = (data as any).properties?.hashed_token;
  if (!tokenHash) throw new Error('no hashed_token from generateLink');
  const { data: verified, error: verErr } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (verErr || !verified.session) throw verErr || new Error('verifyOtp returned no session');
  cachedToken = verified.session.access_token;
  return cachedToken;
}

async function getRandyUserId(): Promise<string> {
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const randy = users?.users.find(u => u.email === 'randyvollrath@gmail.com');
  if (!randy) throw new Error('randyvollrath@gmail.com not found');
  return randy.id;
}

async function postFeedback(diagnosticId: number, body: Record<string, any>): Promise<{ status: number; json: any }> {
  const token = await getRandyAccessToken();
  const res = await fetch(`${HOST}/api/mobile/parking-feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ diagnostic_id: diagnosticId, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function readDiag(id: number) {
  const { data, error } = await sb
    .from('parking_diagnostics')
    .select('user_confirmed_parking, user_confirmed_block, user_reported_side, street_correct, native_meta, user_feedback_at')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

let failures = 0;
function assertEq(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label}: ${ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
  if (!ok) failures += 1;
}

async function run() {
  const userId = await getRandyUserId();

  console.log(`\n[smoke] Inserting synthetic parking_diagnostics row owned by ${userId}…`);
  const insert = await sb
    .from('parking_diagnostics')
    .insert({
      user_id: userId,
      raw_lat: 41.9219,
      raw_lng: -87.6450,
      raw_accuracy_meters: 8,
      resolved_address: '1820 N Fremont St',
      resolved_street_name: 'FREMONT',
      resolved_street_direction: 'N',
      resolved_side: 'E',
    })
    .select('id')
    .single();
  if (insert.error) throw insert.error;
  const diagId = insert.data.id as number;
  console.log(`[smoke] diagnostic_id=${diagId}`);

  try {
    // ── 1. user_hero_confirm — Yes-tap path ────────────────────────────
    console.log('\n=== Yes-tap (user_hero_confirm) ===');
    let r = await postFeedback(diagId, {
      confirmed_parking: true,
      confirmed_block: true,
      feedback_source: 'user_hero_confirm',
    });
    assertEq('status', r.status, 200);
    let row = await readDiag(diagId);
    assertEq('user_confirmed_parking', row.user_confirmed_parking, true);
    assertEq('user_confirmed_block', row.user_confirmed_block, true);
    assertEq('street_correct', row.street_correct, true);
    assertEq('native_meta.feedback_source', (row.native_meta as any)?.feedback_source, 'user_hero_confirm');

    // ── 2. user_hero_wrong_address_open — No-tap that opens the modal ──
    console.log('\n=== No-tap that opens modal (user_hero_wrong_address_open) ===');
    r = await postFeedback(diagId, {
      confirmed_parking: true,
      confirmed_block: false,
      feedback_source: 'user_hero_wrong_address_open',
    });
    assertEq('status', r.status, 200);
    row = await readDiag(diagId);
    assertEq('user_confirmed_block', row.user_confirmed_block, false);
    assertEq('street_correct', row.street_correct, false);
    assertEq('native_meta.feedback_source', (row.native_meta as any)?.feedback_source, 'user_hero_wrong_address_open');

    // ── 3. user_wrong_street_open_map — pin-drag entry point ──────────
    console.log('\n=== Open-map tap (user_wrong_street_open_map) ===');
    r = await postFeedback(diagId, {
      confirmed_parking: true,
      confirmed_block: false,
      feedback_source: 'user_wrong_street_open_map',
    });
    assertEq('status', r.status, 200);
    row = await readDiag(diagId);
    assertEq('native_meta.feedback_source', (row.native_meta as any)?.feedback_source, 'user_wrong_street_open_map');

    // ── 4. Final correction with corrected_address ─────────────────────
    console.log('\n=== Final correction with corrected_address ===');
    r = await postFeedback(diagId, {
      confirmed_parking: true,
      confirmed_block: false,
      feedback_source: 'user_wrong_street_pin_drag',
      corrected_address: '1830 N Fremont St',
    });
    assertEq('status', r.status, 200);
    row = await readDiag(diagId);
    assertEq('native_meta.corrected_address', (row.native_meta as any)?.corrected_address, '1830 N Fremont St');
    assertEq('native_meta.feedback_source', (row.native_meta as any)?.feedback_source, 'user_wrong_street_pin_drag');
    assertEq('user_feedback_at present', typeof row.user_feedback_at === 'string', true);
  } finally {
    console.log(`\n[smoke] Cleaning up diagnostic_id=${diagId}…`);
    const { error: delErr } = await sb.from('parking_diagnostics').delete().eq('id', diagId);
    if (delErr) console.warn(`[smoke] cleanup failed: ${delErr.message}`);
  }

  console.log(`\n[smoke] ${failures === 0 ? 'PASS' : `FAIL — ${failures} assertion(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch(err => {
  console.error('[smoke] Crashed:', err);
  process.exit(2);
});
