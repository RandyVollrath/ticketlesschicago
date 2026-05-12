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

(async () => {
  await unitTests();
  await liveRun();
  console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
