/**
 * Live smoke test for GPS home-address drift detection.
 *
 * Runs computeDriftForUser against the real Supabase DB for every paid user
 * who has a home_address_section set, plus exercises the overnight bucketing
 * helper against synthetic intervals to verify timezone math.
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/smoke-test-home-drift.ts
 *
 * Exit code: 0 on success, non-zero on any throw or unit-assertion failure.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { bucketOvernights, computeDriftForUser } from '../lib/home-address-drift';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(url, key);

let failures = 0;
function check(label: string, cond: boolean, ctx?: any) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}`, ctx ? JSON.stringify(ctx) : '');
    failures++;
  }
}

async function unitTests() {
  console.log('\n[unit] bucketOvernights');

  // Single overnight session: parked 22:00 Mon, cleared 08:00 Tue → 1 bucket on Tue.
  const oneNight = bucketOvernights(
    [{ latitude: 41.9, longitude: -87.6, parked_at: '2026-05-04T03:00:00Z', cleared_at: '2026-05-04T13:00:00Z' }],
    new Date('2026-05-10T12:00:00Z')
  );
  // 03:00 UTC = 22:00 Chicago previous day (CDT, UTC-5). Cleared 13:00 UTC = 08:00 Chicago.
  // Spans 02:00 Chicago on 2026-05-04 → 1 bucket on that date.
  check('one overnight session → 1 bucket', oneNight.length === 1, oneNight);

  // Multi-night session: parked Fri evening, cleared Mon morning → 3 buckets.
  const longSession = bucketOvernights(
    [{ latitude: 41.9, longitude: -87.6, parked_at: '2026-05-01T23:00:00Z', cleared_at: '2026-05-04T14:00:00Z' }],
    new Date('2026-05-10T12:00:00Z')
  );
  check('3-night session → 3 buckets', longSession.length === 3, longSession);

  // Brief afternoon park (no overnight): parked 18:00 UTC = 13:00 Chicago, cleared 22:00 UTC = 17:00 Chicago. 0 buckets.
  const noon = bucketOvernights(
    [{ latitude: 41.9, longitude: -87.6, parked_at: '2026-05-04T18:00:00Z', cleared_at: '2026-05-04T22:00:00Z' }],
    new Date('2026-05-10T12:00:00Z')
  );
  check('afternoon park → 0 buckets', noon.length === 0, noon);

  // Active session (no cleared_at): parked ~2 days ago, still parked.
  // Should yield ≥1 bucket (at least one 02:00 Chicago boundary crossed).
  const stillParked = new Date(Date.now() - 2 * 86400_000);
  const active = bucketOvernights(
    [{ latitude: 41.9, longitude: -87.6, parked_at: stillParked.toISOString(), cleared_at: null }]
  );
  check('still-parked 2-day session → ≥1 bucket', active.length >= 1, { count: active.length });

  // Short still-parked session that hasn't crossed an overnight boundary → 0 buckets.
  // (Started at noon local today, no cleared_at.) Confirms we don't over-count.
  const noonToday = new Date();
  noonToday.setUTCHours(17, 0, 0, 0); // 12 PM Chicago in CDT
  const shortActive = bucketOvernights(
    [{ latitude: 41.9, longitude: -87.6, parked_at: noonToday.toISOString(), cleared_at: null }],
    new Date(noonToday.getTime() + 3 * 3600_000) // 3 hours later
  );
  check('short active session that never crosses 02:00 → 0 buckets', shortActive.length === 0, { count: shortActive.length });

  // Future-dated cleared_at must not walk the loop into the future.
  // Parked yesterday, cleared_at = 30 days from now (clock skew). Should yield
  // exactly 1 bucket (today), not 30.
  const skewNow = new Date('2026-05-12T12:00:00Z');
  const skewParked = new Date(skewNow.getTime() - 86400_000).toISOString();
  const skewCleared = new Date(skewNow.getTime() + 30 * 86400_000).toISOString();
  const skewed = bucketOvernights(
    [{ latitude: 41.9, longitude: -87.6, parked_at: skewParked, cleared_at: skewCleared }],
    skewNow
  );
  check('future-dated cleared_at is clamped to now → ≤1 bucket', skewed.length <= 1, { count: skewed.length });
}

async function liveRun() {
  console.log('\n[live] querying paid users');
  const { data: users, error } = await supabase
    .from('user_profiles')
    .select('user_id, email, home_address_ward, home_address_section')
    .eq('is_paid', true)
    .not('home_address_section', 'is', null);
  if (error) {
    console.error('  query failed:', error.message);
    failures++;
    return;
  }
  console.log(`  ${users?.length ?? 0} paid users with home_address_section`);

  const breakdown: Record<string, number> = {};
  const interesting: any[] = [];
  for (const u of users || []) {
    const userId = (u as any).user_id;
    const email = (u as any).email;
    try {
      const r = await computeDriftForUser(supabase, userId);
      breakdown[r.status] = (breakdown[r.status] || 0) + 1;
      if (r.status === 'DRIFT_DETECTED' || r.status === 'AMBIGUOUS' || r.status === 'CONFIRMED_HOME') {
        interesting.push({
          email,
          status: r.status,
          home: `W${r.home_ward} S${r.home_section}`,
          candidate: `W${r.candidate_ward} S${r.candidate_section}`,
          candidate_fraction: r.candidate_fraction,
          home_fraction: r.home_fraction,
          n: r.overnight_event_count,
        });
      }
    } catch (e: any) {
      console.error(`  error for ${email}:`, e?.message || e);
      failures++;
    }
  }

  console.log('\n[live] status breakdown:', JSON.stringify(breakdown));
  if (interesting.length) {
    console.log('\n[live] non-INSUFFICIENT_DATA / non-STILL_AT_HOME results:');
    for (const row of interesting) console.log('  ', JSON.stringify(row));
  }
}

// End-to-end test: seed synthetic overnight parking for a known test account
// in a section different from their stated home, then confirm
// computeDriftForUser returns DRIFT_DETECTED with the expected candidate
// section. Cleans up the seeded rows afterward.
//
// Test account: hellodolldarlings@gmail.com (paid, home W47 S15, no real
// parking history). Seed location: 41.92624, -87.66386 (W32 S12 — Logan
// Square area).
const SEED_EMAIL = 'hellodolldarlings@gmail.com';
const SEED_LAT = 41.92624;
const SEED_LNG = -87.66386;
const EXPECTED_CANDIDATE_WARD = '32';
const EXPECTED_CANDIDATE_SECTION = '12';
const SEED_ADDRESS_MARKER = '__home_drift_smoke_seed__';

async function seedTest() {
  console.log('\n[seed] end-to-end synthetic drift detection');

  const { data: usersData, error: listErr } = await (supabase as any).auth.admin.listUsers({ perPage: 500 });
  if (listErr) {
    console.error('  listUsers failed:', listErr.message);
    failures++;
    return;
  }
  const testUser = usersData?.users?.find((u: any) => u.email === SEED_EMAIL);
  if (!testUser) {
    console.log(`  SKIP  test account ${SEED_EMAIL} not found in auth.users — seed test cannot run`);
    return;
  }
  const userId = testUser.id;

  // Confirm baseline state: paid + home W47/S15 (or any non-W32/S12).
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('is_paid, home_address_ward, home_address_section')
    .eq('user_id', userId)
    .maybeSingle();
  if (!profile?.is_paid || !profile?.home_address_section) {
    console.log(`  SKIP  ${SEED_EMAIL} not paid or missing home_address_section — fix the test account and rerun`);
    return;
  }
  if (
    profile.home_address_ward === EXPECTED_CANDIDATE_WARD &&
    profile.home_address_section === EXPECTED_CANDIDATE_SECTION
  ) {
    console.log(`  SKIP  ${SEED_EMAIL} home is already W${EXPECTED_CANDIDATE_WARD} S${EXPECTED_CANDIDATE_SECTION}; pick another seed location`);
    return;
  }

  // Idempotent cleanup before seeding — wipe any stale rows from prior runs.
  await supabase.from('parking_location_history').delete().eq('user_id', userId).eq('address', SEED_ADDRESS_MARKER);

  // Seed 14 overnight buckets across the last 21 days. Each row: parked
  // at 20:00 local one day, cleared 08:00 local the next. We space them
  // every other day so we have 14 rows across 20 days (well above the
  // MIN_OVERNIGHT_EVENTS=10 threshold).
  const now = Date.now();
  const rows: any[] = [];
  for (let i = 0; i < 14; i++) {
    const dayOffset = 1 + i; // start at "yesterday" and walk back
    const parkedAt = new Date(now - dayOffset * 86400_000);
    parkedAt.setUTCHours(1, 0, 0, 0); // 01:00 UTC = 20:00 Chicago previous evening (CDT)
    const clearedAt = new Date(parkedAt.getTime() + 12 * 3600_000); // 12 hours later (08:00 UTC = 03:00 Chicago next day)
    rows.push({
      user_id: userId,
      latitude: SEED_LAT,
      longitude: SEED_LNG,
      address: SEED_ADDRESS_MARKER,
      parked_at: parkedAt.toISOString(),
      cleared_at: clearedAt.toISOString(),
    });
  }

  const { error: insErr } = await supabase.from('parking_location_history').insert(rows);
  if (insErr) {
    console.error('  insert failed:', insErr.message);
    failures++;
    return;
  }

  let result;
  try {
    result = await computeDriftForUser(supabase, userId);
  } finally {
    // Always clean up so the next scheduled cron doesn't trigger a real
    // DRIFT_DETECTED + admin email about this test user.
    await supabase.from('parking_location_history').delete().eq('user_id', userId).eq('address', SEED_ADDRESS_MARKER);
  }

  check(`seeded user → status === DRIFT_DETECTED`, result.status === 'DRIFT_DETECTED', { status: result.status, candidate_fraction: result.candidate_fraction, n: result.overnight_event_count });
  check(`seeded user → candidate_ward === ${EXPECTED_CANDIDATE_WARD}`, result.candidate_ward === EXPECTED_CANDIDATE_WARD, { got: result.candidate_ward });
  check(`seeded user → candidate_section === ${EXPECTED_CANDIDATE_SECTION}`, result.candidate_section === EXPECTED_CANDIDATE_SECTION, { got: result.candidate_section });
  check(`seeded user → candidate_lat near ${SEED_LAT}`, result.candidate_lat != null && Math.abs(result.candidate_lat - SEED_LAT) < 0.001, { got: result.candidate_lat });
  check(`seeded user → candidate_lng near ${SEED_LNG}`, result.candidate_lng != null && Math.abs(result.candidate_lng - SEED_LNG) < 0.001, { got: result.candidate_lng });
  check(`seeded user → overnight_event_count >= 10`, result.overnight_event_count >= 10, { n: result.overnight_event_count });

  // Confirm cleanup landed (defense in depth).
  const { count: leftover } = await supabase
    .from('parking_location_history')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('address', SEED_ADDRESS_MARKER);
  check('seed rows cleaned up', leftover === 0, { leftover });
}

(async () => {
  await unitTests();
  await liveRun();
  await seedTest();
  console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
