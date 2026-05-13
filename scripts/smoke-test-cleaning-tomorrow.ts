#!/usr/bin/env tsx
/**
 * Smoke test: street cleaning TOMORROW shows up as a warning.
 *
 * Bug we're guarding against: when a user parked at night on a street that
 * has cleaning the next morning, the hero card showed no warning.
 * unified-parking-checker.ts treated next-day cleaning as severity='info',
 * and the home screen filters info rules out. Only the morning-of 7am push
 * notification fired — too late for a user parking at 10pm to plan ahead.
 *
 * This test hits the live check-parking endpoint at coordinates known to
 * have cleaning *tomorrow* (Chicago time) and asserts:
 *   - streetCleaning.timing === 'TOMORROW'
 *   - streetCleaning.severity === 'warning'
 *   - message mentions "tomorrow"
 *
 * The coordinate is resolved at runtime by querying the live Supabase
 * street_cleaning_schedule for a row where cleaning_date = tomorrow, so the
 * test stays valid as time advances.
 *
 * Run: SMOKE_HOST=https://www.autopilotamerica.com npx tsx scripts/smoke-test-cleaning-tomorrow.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const HOST = process.env.SMOKE_HOST || 'https://www.autopilotamerica.com';
const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error('[smoke] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env / .env.local');
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

function chicagoTomorrowISO(): string {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  now.setDate(now.getDate() + 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getRandyAccessToken(): Promise<string> {
  const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const randy = users?.users.find(u => u.email === 'randyvollrath@gmail.com');
  if (!randy) throw new Error('randyvollrath@gmail.com not found');
  const { data, error } = await sb.auth.admin.generateLink({ type: 'magiclink', email: randy.email! });
  if (error) throw error;
  const tokenHash = (data as any).properties?.hashed_token;
  if (!tokenHash) throw new Error('no hashed_token from generateLink');
  const { data: verified, error: verErr } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (verErr || !verified.session) throw verErr || new Error('verifyOtp returned no session');
  return verified.session.access_token;
}

// Seed coords known to fall on a real street centerline inside a
// street_cleaning_schedule polygon. Polygon centroids alone don't work —
// they may land off-street and trip the snap/sameStreet suppression in
// unified-parking-checker. These come from intersecting Chicago centerlines
// with cleaning zones. We probe each via the same spatial RPC the API
// uses and pick the first whose next_cleaning_date is tomorrow Chicago time.
// If none match, the smoke flags it loudly rather than green-lighting on
// stale data.
const SEED_COORDS: Array<{ lat: number; lng: number; label: string }> = [
  { lat: 41.9435025379354, lng: -87.6449251699459, label: '3350 N Broadway (Ward 44 Sec 7)' },
  { lat: 41.9454437766665, lng: -87.6486628881052, label: '750 W Cornelia (Ward 44 Sec 7)' },
  { lat: 41.9436667526267, lng: -87.6461880008013, label: '625 W Roscoe (Ward 44 Sec 7)' },
];

async function findTomorrowCleaningCoord(): Promise<{ lat: number; lng: number; label: string }> {
  const tomorrow = chicagoTomorrowISO();
  for (const seed of SEED_COORDS) {
    const { data, error } = await sb.rpc('get_street_cleaning_at_location_enhanced', {
      user_lat: seed.lat,
      user_lng: seed.lng,
      distance_meters: 30,
    });
    if (error) {
      console.warn(`[smoke] RPC error at ${seed.label}: ${error.message}`);
      continue;
    }
    const row = (data as any)?.[0];
    if (row && row.next_cleaning_date === tomorrow) {
      console.log(`[smoke] Matched seed ${seed.label} — next_cleaning_date=${row.next_cleaning_date}`);
      return seed;
    }
  }
  throw new Error(`No seed coord has next_cleaning_date=${tomorrow}; add a fresh seed (DB query: SELECT ward, section, ST_AsText(ST_Centroid(geom)) FROM street_cleaning_schedule WHERE cleaning_date='${tomorrow}' LIMIT 5).`);
}

async function main() {
  const tomorrow = chicagoTomorrowISO();
  console.log(`[smoke] Looking for a street with cleaning on ${tomorrow} (Chicago tomorrow)…`);

  const coord = await findTomorrowCleaningCoord();
  console.log(`[smoke] Using coord (${coord.lat}, ${coord.lng}) — ${coord.label}`);

  const token = await getRandyAccessToken();
  const res = await fetch(`${HOST}/api/mobile/check-parking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ latitude: coord.lat, longitude: coord.lng }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[smoke] check-parking returned ${res.status}: ${JSON.stringify(json).slice(0, 400)}`);
    process.exit(1);
  }

  const sc = json.streetCleaning || {};
  console.log(`[smoke] streetCleaning =`, JSON.stringify({
    hasRestriction: sc.hasRestriction, timing: sc.timing, severity: sc.severity,
    nextDate: sc.nextDate, message: sc.message,
  }, null, 2));

  let failures = 0;
  function assertEq(label: string, actual: unknown, expected: unknown) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label}: ${ok ? '' : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) failures += 1;
  }
  function assertTruthy(label: string, value: unknown) {
    const ok = Boolean(value);
    console.log(`  ${ok ? 'OK ' : 'FAIL'} ${label}: ${ok ? '' : `expected truthy, got ${JSON.stringify(value)}`}`);
    if (!ok) failures += 1;
  }

  assertTruthy('streetCleaning.hasRestriction', sc.hasRestriction);
  assertEq('streetCleaning.timing', sc.timing, 'TOMORROW');
  assertEq('streetCleaning.severity', sc.severity, 'warning');
  assertEq('streetCleaning.nextDate', sc.nextDate, tomorrow);
  assertTruthy('message mentions "tomorrow"', /tomorrow/i.test(String(sc.message || '')));

  if (failures > 0) {
    console.error(`\n[smoke] ${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\n[smoke] All assertions passed.');
}

main().catch((e) => {
  console.error(`[smoke] Unhandled error: ${e?.stack || e}`);
  process.exit(1);
});
