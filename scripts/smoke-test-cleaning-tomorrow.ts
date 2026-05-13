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

// Dynamically discover a seed coord whose cleaning date is tomorrow.
// We intersect every tomorrow-cleaning polygon with Chicago street
// centerlines (class 3/4 = residential/collector) and pick the midpoint
// of the intersection — a coord that's guaranteed to land on a real
// street inside an active cleaning zone. This keeps the test green as
// cleaning dates rotate weekly.
//
// Polygon centroids alone don't work: they may land off-street and trip
// the snap/sameStreet check elsewhere in the pipeline. Real-street
// coords don't.
async function findTomorrowCleaningCoord(): Promise<{ lat: number; lng: number; label: string }> {
  const tomorrow = chicagoTomorrowISO();
  const sql = `
    WITH tomorrow_zones AS (
      SELECT ward, section, geom FROM street_cleaning_schedule
      WHERE cleaning_date = '${tomorrow}' LIMIT 5
    )
    SELECT z.ward, z.section, sc.pre_dir, sc.street_base_name,
           ST_Y(ST_LineInterpolatePoint(ST_Intersection(sc.geom, z.geom), 0.5)) AS lat,
           ST_X(ST_LineInterpolatePoint(ST_Intersection(sc.geom, z.geom), 0.5)) AS lng
    FROM tomorrow_zones z, street_centerlines sc
    WHERE ST_Intersects(sc.geom, z.geom)
      AND sc.class IN ('3','4')
      AND sc.street_base_name IS NOT NULL
    LIMIT 3;
  `;
  // Use a generic RPC for ad-hoc SQL. If the project doesn't expose one,
  // fall back to a static seed list.
  let data: any = null;
  try {
    const result = await sb.rpc('execute_sql_smoke', { sql_query: sql });
    data = result.data;
  } catch {
    data = null;
  }
  if (data && Array.isArray(data) && data.length > 0) {
    const r = data[0] as any;
    return {
      lat: r.lat,
      lng: r.lng,
      label: `${r.pre_dir} ${r.street_base_name} (Ward ${r.ward} Sec ${r.section})`,
    };
  }

  // Fallback: probe via the spatial RPC over a tight seed grid. Each row
  // here is a known Chicago intersection that has fallen inside a
  // cleaning polygon in past weeks. Refresh by running:
  //   SELECT ST_Y(ST_LineInterpolatePoint(ST_Intersection(sc.geom, z.geom), 0.5)),
  //          ST_X(...) FROM street_cleaning_schedule z, street_centerlines sc
  //   WHERE z.cleaning_date='<tomorrow>' AND ST_Intersects(sc.geom, z.geom)
  //         AND sc.class IN ('3','4') AND sc.street_base_name IS NOT NULL LIMIT 5;
  // Sections from the centerline-intersect query above. Refresh when the
  // smoke fails — pick a section that cleans ONLY tomorrow (not today),
  // otherwise the RPC returns today as next_cleaning_date and the test
  // can't distinguish today-only from tomorrow-only behavior:
  //   WITH tomorrow AS (SELECT ward,section FROM street_cleaning_schedule WHERE cleaning_date='<tomorrow>'),
  //        today    AS (SELECT ward,section FROM street_cleaning_schedule WHERE cleaning_date='<today>')
  //   SELECT t.ward, t.section FROM tomorrow t LEFT JOIN today td USING (ward,section)
  //   WHERE td.ward IS NULL LIMIT 5;
  const SEED_GRID: Array<{ lat: number; lng: number; label: string }> = [
    // Ward 44 Section 1 — Lakeview, cleans May 14 but not May 13
    { lat: 41.9452324795062, lng: -87.664577885605, label: 'W Cornelia (Ward 44 Sec 1)' },
    { lat: 41.9415866260544, lng: -87.6641762162928, label: 'W School (Ward 44 Sec 1)' },
    { lat: 41.944423775752, lng: -87.6651597735277, label: 'N Janssen (Ward 44 Sec 1)' },
    { lat: 41.9470393915766, lng: -87.6658345003811, label: 'W Addison (Ward 44 Sec 1)' },
    // Older seeds — kept so the test self-heals when zones rotate
    { lat: 41.9435025379354, lng: -87.6449251699459, label: '3350 N Broadway (Lakeview)' },
    { lat: 41.9078894361407, lng: -87.6272644757966, label: 'Ward 43 anchor (Lincoln Park)' },
    { lat: 41.8585741789793, lng: -87.6760009036582, label: 'W 17th & Damen (Pilsen)' },
  ];
  for (const seed of SEED_GRID) {
    const { data: rpcData, error: rpcErr } = await sb.rpc('get_street_cleaning_at_location_enhanced', {
      user_lat: seed.lat,
      user_lng: seed.lng,
      distance_meters: 30,
    });
    if (rpcErr) continue;
    const row = (rpcData as any)?.[0];
    if (row && row.next_cleaning_date === tomorrow) {
      console.log(`[smoke] Matched fallback seed ${seed.label} — next_cleaning_date=${row.next_cleaning_date}`);
      return seed;
    }
  }
  throw new Error(`No seed coord has next_cleaning_date=${tomorrow}. Run the centerline-intersect query above and add a fresh seed.`);
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
