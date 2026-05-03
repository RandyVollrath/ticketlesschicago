#!/usr/bin/env npx tsx
/**
 * Live verification: are meter notifications actually working end-to-end?
 *
 * Specifically checks:
 *   1. Are recently-parked vehicles getting their meter snapshot fields populated?
 *      (i.e., did the save-parked-location change actually flow into prod?)
 *   2. Have any meter notifications actually fired? (notification_logs / cron stats)
 *   3. For currently-parked vehicles in meter zones, would the cron fire NOW
 *      with the timing logic we have? Walk through each branch by hand.
 *   4. Sanity check: pick a known meter address, run checkMeteredParking, confirm
 *      the snapshot fields it produces match what would actually trigger a push.
 *
 * Run: node -r dotenv/config node_modules/.bin/tsx scripts/verify-meter-notifications-live.ts dotenv_config_path=.env.local
 */
import { createClient } from '@supabase/supabase-js';
import { checkMeteredParking } from '../lib/metered-parking-checker';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing supabase env');
  const s = createClient(url, key, { auth: { persistSession: false } });

  // ─────────────────────────────────────────────────────────────
  console.log('\n=== 1. Are meter snapshot fields populated on recent parks? ===');
  // ─────────────────────────────────────────────────────────────
  const { data: recentParks, error: e1 } = await s
    .from('user_parked_vehicles')
    .select('id, user_id, address, parked_at, is_active, meter_zone_active, meter_max_time_minutes, meter_schedule_text, meter_was_enforced_at_park_time, meter_max_notified_at, meter_active_notified_at')
    .order('parked_at', { ascending: false })
    .limit(20);
  if (e1) {
    console.error('SELECT failed:', e1.message);
    process.exit(1);
  }

  console.log(`Last ${recentParks?.length} parks (most recent first):`);
  for (const r of recentParks ?? []) {
    const meterFlag = r.meter_zone_active === true ? '✓METER' : '·';
    const minutes = r.meter_max_time_minutes ?? '—';
    const sched = r.meter_schedule_text ?? '—';
    const enforced = r.meter_was_enforced_at_park_time;
    console.log(`  [${r.is_active ? 'A' : '-'}] ${meterFlag} ${r.parked_at}  max=${minutes}m  was_enforced=${enforced}  sched="${sched}"  addr=${(r.address ?? '').slice(0, 40)}`);
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n=== 2. Counts: how many parks have meter_zone_active=true since 2026-04-27? ===');
  // ─────────────────────────────────────────────────────────────
  const { count: meterParks } = await s
    .from('user_parked_vehicles')
    .select('id', { count: 'exact', head: true })
    .eq('meter_zone_active', true)
    .gte('parked_at', '2026-04-27');
  const { count: totalParks } = await s
    .from('user_parked_vehicles')
    .select('id', { count: 'exact', head: true })
    .gte('parked_at', '2026-04-27');
  console.log(`  Total parks since 2026-04-27: ${totalParks}`);
  console.log(`  ...with meter_zone_active=true: ${meterParks}`);
  if ((totalParks ?? 0) > 0 && (meterParks ?? 0) === 0) {
    console.log('  ⚠ No parks tagged as meter zones since the migration. Either no one parked at a meter, or the snapshot isn\'t being captured.');
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n=== 3. Have any meter notifications been sent? ===');
  // ─────────────────────────────────────────────────────────────
  const { data: meterMaxFires } = await s
    .from('user_parked_vehicles')
    .select('id, user_id, address, parked_at, meter_max_notified_at, meter_max_time_minutes')
    .not('meter_max_notified_at', 'is', null)
    .order('meter_max_notified_at', { ascending: false })
    .limit(10);
  const { data: meterActiveFires } = await s
    .from('user_parked_vehicles')
    .select('id, user_id, address, parked_at, meter_active_notified_at, meter_schedule_text')
    .not('meter_active_notified_at', 'is', null)
    .order('meter_active_notified_at', { ascending: false })
    .limit(10);
  console.log(`  meter_max_notified_at fires (lifetime): ${meterMaxFires?.length}`);
  meterMaxFires?.forEach(f => console.log(`    ${f.meter_max_notified_at}  parked=${f.parked_at}  max=${f.meter_max_time_minutes}m  addr=${(f.address ?? '').slice(0, 40)}`));
  console.log(`  meter_active_notified_at fires (lifetime): ${meterActiveFires?.length}`);
  meterActiveFires?.forEach(f => console.log(`    ${f.meter_active_notified_at}  parked=${f.parked_at}  sched="${f.meter_schedule_text}"  addr=${(f.address ?? '').slice(0, 40)}`));

  // ─────────────────────────────────────────────────────────────
  console.log('\n=== 4. Currently active parks in meter zones — would the cron fire? ===');
  // ─────────────────────────────────────────────────────────────
  const { data: activeMeterParks } = await s
    .from('user_parked_vehicles')
    .select('id, user_id, address, fcm_token, parked_at, meter_zone_active, meter_max_time_minutes, meter_schedule_text, meter_was_enforced_at_park_time, meter_max_notified_at, meter_active_notified_at')
    .eq('is_active', true)
    .eq('meter_zone_active', true);
  console.log(`  Active parks in meter zones right now: ${activeMeterParks?.length ?? 0}`);
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  for (const r of activeMeterParks ?? []) {
    if (!r.meter_max_time_minutes) {
      console.log(`    skip: no max time (${r.id})`);
      continue;
    }
    const parkedAt = new Date(r.parked_at);
    const expiresAt = new Date(parkedAt.getTime() + r.meter_max_time_minutes * 60_000);
    const fireAt = new Date(expiresAt.getTime() - 30 * 60_000);
    const minsUntilFire = Math.round((fireAt.getTime() - now.getTime()) / 60_000);
    const minsSinceFire = -minsUntilFire;
    let state = 'pending';
    if (minsUntilFire > 0) state = `fires in ${minsUntilFire}m (at ${fireAt.toLocaleTimeString()})`;
    else if (minsSinceFire <= 35 && !r.meter_max_notified_at) state = `IN WINDOW NOW (fired ${minsSinceFire}m ago)`;
    else if (r.meter_max_notified_at) state = `already notified at ${r.meter_max_notified_at}`;
    else state = `expired ${minsSinceFire}m ago — past window`;
    console.log(`    ${r.id}: parked ${r.parked_at} max=${r.meter_max_time_minutes}m enforced_at_park=${r.meter_was_enforced_at_park_time} → ${state}`);
  }

  // ─────────────────────────────────────────────────────────────
  console.log('\n=== 5. Live checkMeteredParking on a known meter address ===');
  // ─────────────────────────────────────────────────────────────
  const { data: knownMeter } = await s
    .from('metered_parking_locations')
    .select('latitude, longitude, address, time_limit_hours, rate_description')
    .eq('status', 'Active')
    .eq('time_limit_hours', 2)
    .not('latitude', 'is', null)
    .limit(1)
    .single();
  if (knownMeter) {
    console.log(`  Probing ${knownMeter.address} (lat=${knownMeter.latitude}, lng=${knownMeter.longitude})`);
    const result = await checkMeteredParking(knownMeter.latitude, knownMeter.longitude);
    console.log(`    inMeteredZone=${result.inMeteredZone}`);
    console.log(`    timeLimitMinutes=${result.timeLimitMinutes}`);
    console.log(`    isEnforcedNow=${result.isEnforcedNow}`);
    console.log(`    scheduleText="${result.scheduleText}"`);
    console.log(`    severity=${result.severity}`);
    if (!result.inMeteredZone) {
      console.log('    ⚠ checkMeteredParking returned inMeteredZone=false on a KNOWN active meter — investigate side-of-street or geocoder.');
    }
  }
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
