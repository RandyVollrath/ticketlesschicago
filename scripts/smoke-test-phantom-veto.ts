#!/usr/bin/env tsx
/**
 * Smoke test for the phantom-trip veto added to /api/mobile/save-parked-location
 * on 2026-05-17.
 *
 * The veto refuses to save a "parking" event when the user's most recent
 * parking_location_history row has cleared_at=NULL, was inserted >5 min ago,
 * and the proposed new park is within ~300m of the previous one. That's the
 * signature of a phantom trip — mobile detected a fake "I parked" without
 * ever having reported the user leaving the previous spot.
 *
 * This test verifies three scenarios against the real production endpoint:
 *
 *   Case A (must veto)  — uncleared 30-min-old prior park + same coords
 *   Case B (must pass)  — uncleared 30-min-old prior park + 500m away
 *   Case C (must pass)  — prior park with cleared_at set + same coords
 *
 * Every row inserted by the test is tagged with a unique smoke_run_id in the
 * address field and cleaned up in `finally`, regardless of pass/fail. The
 * audit_logs row created by the veto in Case A is also cleaned up.
 *
 * Run against production (default):
 *   npx tsx scripts/smoke-test-phantom-veto.ts
 *
 * Run against localhost (must have `next dev` running):
 *   SMOKE_HOST=http://localhost:3000 npx tsx scripts/smoke-test-phantom-veto.ts
 *
 * Exit 0 on full pass, non-zero on any assertion failure.
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const HOST = process.env.SMOKE_HOST || 'https://www.autopilotamerica.com';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
// Use the QA bot — Randy's account has real parking activity that interferes
// with the "most recent row" lookup. qa-bot has no real activity, so the
// rows we insert are the most recent for the veto check.
const TEST_EMAIL = process.env.SMOKE_TEST_EMAIL || 'qa-bot@autopilotamerica.com';

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('[smoke] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

const runId = `smoke_phantom_veto_${Date.now()}`;
const insertedHistoryIds: string[] = [];
const insertedActiveIds: string[] = [];
let failed = false;

function log(msg: string) { console.log(`[smoke] ${msg}`); }
function ok(msg: string) { console.log(`[smoke]   ✓ ${msg}`); }
function fail(msg: string) { console.error(`[smoke]   ✗ ${msg}`); failed = true; }

async function getUserId(): Promise<string> {
  const { data: users, error } = await sb.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const u = users?.users.find(x => x.email === TEST_EMAIL);
  if (!u) throw new Error(`${TEST_EMAIL} not found`);
  return u.id;
}

let cachedToken: string | null = null;
async function getAccessToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: TEST_EMAIL });
  if (error) throw error;
  const tokenHash = (data as any).properties?.hashed_token;
  if (!tokenHash) throw new Error('no hashed_token from generateLink');
  const { data: verified, error: verErr } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (verErr || !verified.session) throw verErr || new Error('verifyOtp returned no session');
  cachedToken = verified.session.access_token;
  return cachedToken;
}

async function insertPriorRow(opts: { userId: string; lat: number; lng: number; minutesAgo: number; cleared: boolean }): Promise<string> {
  const parkedAt = new Date(Date.now() - opts.minutesAgo * 60 * 1000).toISOString();
  const clearedAt = opts.cleared ? new Date(Date.now() - (opts.minutesAgo - 5) * 60 * 1000).toISOString() : null;
  const { data, error } = await sb
    .from('parking_location_history')
    .insert({
      user_id: opts.userId,
      latitude: opts.lat,
      longitude: opts.lng,
      address: `${runId} prior cleared=${opts.cleared}`,
      parked_at: parkedAt,
      cleared_at: clearedAt,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`insertPriorRow failed: ${error?.message}`);
  insertedHistoryIds.push(data.id);
  return data.id;
}

async function postSave(token: string, lat: number, lng: number): Promise<{ status: number; body: any }> {
  const res = await fetch(`${HOST}/api/mobile/save-parked-location`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      latitude: lat,
      longitude: lng,
      address: `${runId} proposed park`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function deleteRows(userId: string) {
  log(`cleaning up — ${insertedHistoryIds.length} history rows, scanning for active + audit logs tagged ${runId}`);

  if (insertedHistoryIds.length > 0) {
    await sb.from('parking_location_history').delete().in('id', insertedHistoryIds);
  }

  // The endpoint may have created additional rows if any test case PASSED (not vetoed):
  // a new parking_location_history insert tagged "<runId> proposed park" + a user_parked_vehicles row.
  await sb.from('parking_location_history').delete().eq('user_id', userId).like('address', `${runId}%`);
  await sb.from('user_parked_vehicles').delete().eq('user_id', userId).like('address', `${runId}%`);

  // Audit logs from veto firing
  await sb.from('audit_logs').delete().eq('user_id', userId).eq('action_type', 'parking_event_vetoed').gte('created_at', new Date(Date.now() - 10 * 60 * 1000).toISOString());
}

async function main() {
  log(`HOST=${HOST}  runId=${runId}`);
  const userId = await getUserId();
  const token = await getAccessToken();
  log(`user=${userId}`);

  // Use coordinates well off the Chicago road grid (in Lake Michigan, ~3 miles
  // out from Navy Pier) so we don't risk colliding with any real saved
  // location or street-cleaning zone.
  const lakeLat = 41.892;
  const lakeLng = -87.557;

  // Wipe ALL parking_location_history + user_parked_vehicles rows for the
  // test account so the rows we insert are guaranteed to be "the most recent"
  // for the veto's lookup. Safe because qa-bot has no real activity.
  await sb.from('parking_location_history').delete().eq('user_id', userId).select('id');
  await sb.from('user_parked_vehicles').delete().eq('user_id', userId).select('id');
  await sb.from('audit_logs').delete().eq('user_id', userId).eq('action_type', 'parking_event_vetoed').select('id');

  // Verify wipe took effect — without this, leftover state would make the
  // "most recent row" lookup return the wrong row and the test would fail
  // for the wrong reason.
  const verify = await sb
    .from('parking_location_history')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if ((verify.count ?? 0) > 0) {
    throw new Error(`pre-test wipe left ${verify.count} rows in parking_location_history for ${TEST_EMAIL}`);
  }

  try {
    // -------- CASE A — must veto --------
    log('Case A: prior park 30 min ago, uncleared, new park at SAME coords — must veto');
    const priorA = await insertPriorRow({ userId, lat: lakeLat, lng: lakeLng, minutesAgo: 30, cleared: false });
    const resA = await postSave(token, lakeLat, lakeLng);
    if (resA.status !== 200) fail(`status=${resA.status} expected 200; body=${JSON.stringify(resA.body)}`);
    else if (resA.body?.vetoed === true && resA.body?.veto_reason === 'no_departure_since_previous_park') {
      ok(`vetoed=true, reason=${resA.body.veto_reason}`);
    } else {
      fail(`expected vetoed=true with reason no_departure_since_previous_park; got ${JSON.stringify(resA.body)}`);
    }

    // Verify an audit_logs row got created. Retry up to 3 times with a
    // short delay — there's a small window after the API handler returns
    // its response before a subsequent read from a different connection
    // sees the inserted row.
    let audit = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1000));
      const result = await sb
        .from('audit_logs')
        .select('id, action_type, action_details, status')
        .eq('user_id', userId)
        .eq('action_type', 'parking_event_vetoed')
        .eq('entity_id', priorA)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      audit = result.data;
      if (audit) break;
    }
    if (audit && audit.status === 'rejected' && (audit.action_details as any)?.reason === 'no_departure_since_previous_park') {
      ok(`audit log written (id=${audit.id})`);
    } else {
      fail(`no audit_logs row found for prior=${priorA} after 10 retries (10s)`);
    }

    // Wipe between cases so each case has a clean slate (the veto looks at
    // "most recent row" — any leftover row interferes).
    await sb.from('parking_location_history').delete().eq('user_id', userId);
    await sb.from('user_parked_vehicles').delete().eq('user_id', userId);

    // -------- CASE B — must pass (distance) --------
    log('Case B: prior park 30 min ago, uncleared, new park 500m away — must pass');
    const priorB = await insertPriorRow({ userId, lat: lakeLat, lng: lakeLng, minutesAgo: 30, cleared: false });
    // Shift longitude by ~500m east (0.006° lng ≈ 500m at this latitude)
    const resB = await postSave(token, lakeLat, lakeLng + 0.006);
    if (resB.status !== 200) fail(`status=${resB.status} expected 200; body=${JSON.stringify(resB.body)}`);
    else if (resB.body?.vetoed) {
      fail(`expected to pass but was vetoed: ${JSON.stringify(resB.body)}`);
    } else if (resB.body?.success && resB.body?.id) {
      ok(`saved id=${resB.body.id}`);
    } else {
      fail(`unexpected response: ${JSON.stringify(resB.body)}`);
    }

    await sb.from('parking_location_history').delete().eq('user_id', userId);
    await sb.from('user_parked_vehicles').delete().eq('user_id', userId);

    // -------- CASE C — must pass (cleared_at set) --------
    log('Case C: prior park 30 min ago, CLEARED, new park at same coords — must pass');
    const priorC = await insertPriorRow({ userId, lat: lakeLat, lng: lakeLng, minutesAgo: 30, cleared: true });
    const resC = await postSave(token, lakeLat, lakeLng);
    if (resC.status !== 200) fail(`status=${resC.status} expected 200; body=${JSON.stringify(resC.body)}`);
    else if (resC.body?.vetoed) {
      fail(`expected to pass but was vetoed: ${JSON.stringify(resC.body)}`);
    } else if (resC.body?.success && resC.body?.id) {
      ok(`saved id=${resC.body.id}`);
    } else {
      fail(`unexpected response: ${JSON.stringify(resC.body)}`);
    }
  } finally {
    await deleteRows(userId);
  }

  if (failed) {
    console.error('\n[smoke] FAIL');
    process.exit(1);
  }
  console.log('\n[smoke] PASS — phantom-trip veto works as designed.');
}

main().catch((e) => {
  console.error('[smoke] ERROR:', e);
  process.exit(2);
});
