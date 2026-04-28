#!/usr/bin/env npx tsx
/**
 * Probe-only: confirm the schemas we need before building meter + sticker
 * push notifications.
 *
 * Run:
 *   node -r dotenv/config node_modules/.bin/tsx scripts/probe-meter-sticker-schema.ts dotenv_config_path=.env.local
 */

import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing supabase env');
  const s = createClient(url, key, { auth: { persistSession: false } });

  console.log('=== METER LOCATIONS sample row ===');
  const { data: meters, error: mErr } = await s
    .from('metered_parking_locations')
    .select('*')
    .eq('status', 'Active')
    .limit(2);
  if (mErr) throw mErr;
  console.log(JSON.stringify(meters?.[0] ?? null, null, 2));
  console.log('time_limit_hours distinct values (sample of 1000):');
  const { data: tlim } = await s
    .from('metered_parking_locations')
    .select('time_limit_hours')
    .limit(1000);
  const counts = new Map<number, number>();
  (tlim ?? []).forEach((r: any) => {
    const k = Number(r.time_limit_hours ?? 0);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  console.log([...counts.entries()].sort((a, b) => b[1] - a[1]));

  console.log('\n=== USER_PARKED_VEHICLES columns (active sample row) ===');
  const { data: upv, error: uErr } = await s
    .from('user_parked_vehicles')
    .select('*')
    .eq('is_active', true)
    .limit(1);
  if (uErr) throw uErr;
  if (upv?.[0]) {
    console.log('Columns:', Object.keys(upv[0]).sort());
  } else {
    console.log('No active rows. Trying any row:');
    const { data: any1 } = await s.from('user_parked_vehicles').select('*').limit(1);
    if (any1?.[0]) console.log('Columns:', Object.keys(any1[0]).sort());
    else console.log('Table empty');
  }

  console.log('\n=== USER_PROFILES sticker fields (paid users sample) ===');
  const { data: prof, error: pErr } = await s
    .from('user_profiles')
    .select('user_id, email, city_sticker_expiry, license_plate_expiry, push_alert_preferences, notify_email, notify_sms, phone, has_contesting')
    .eq('is_paid', true)
    .not('city_sticker_expiry', 'is', null)
    .limit(3);
  if (pErr) throw pErr;
  console.log(`paid users with city_sticker_expiry set: ${prof?.length ?? 0}`);
  prof?.forEach(p => {
    console.log({
      email: p.email?.slice(0, 4) + '***',
      city: p.city_sticker_expiry,
      plate: p.license_plate_expiry,
      hasFcm: !!p.fcm_token,
      pushPrefs: p.push_alert_preferences,
    });
  });

  console.log('\n=== Counts ===');
  const { count: paidWithSticker } = await s
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('is_paid', true)
    .not('city_sticker_expiry', 'is', null);
  const { count: paidTotal } = await s
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('is_paid', true);
  console.log({ paidTotal, paidWithSticker });

  console.log('\n=== push_tokens table ===');
  const { data: pt, error: ptErr } = await s.from('push_tokens').select('*').limit(2);
  if (ptErr) console.log('push_tokens err:', ptErr.message);
  else if (pt?.[0]) console.log('Columns:', Object.keys(pt[0]).sort());
  else console.log('push_tokens empty');

  console.log('\n=== Sample metered_parking_locations rate_description values ===');
  const { data: descs } = await s
    .from('metered_parking_locations')
    .select('rate_description, time_limit_hours, sunday_schedule, rush_hour_schedule, is_seasonal')
    .eq('status', 'Active')
    .limit(8);
  descs?.forEach(d => console.log(d));
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
