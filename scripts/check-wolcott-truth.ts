#!/usr/bin/env npx tsx
/**
 * Pull every parking_diagnostics row at the Wolcott coordinate and any
 * user feedback so we can determine ground-truth: is this spot really
 * Wolcott (snap+nominatim) or Lawrence (Mapbox)?
 */

import { createClient } from '@supabase/supabase-js';

const LAT = 41.9685220198643;
const LNG = -87.6761162690139;

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: rows } = await s
    .from('parking_diagnostics')
    .select('id, created_at, raw_lat, raw_lng, snap_street_name, snap_distance_meters, snap_source, nominatim_street, resolved_address, resolved_street_name, resolved_house_number, user_confirmed_block, user_reported_side, street_correct, side_correct, user_feedback_at, gps_source')
    .eq('raw_lat', LAT)
    .eq('raw_lng', LNG)
    .order('created_at', { ascending: false });

  console.log(`Rows at exact coord ${LAT}, ${LNG}: ${rows?.length ?? 0}\n`);
  for (const r of rows ?? []) {
    console.log(`row ${r.id} @ ${r.created_at} (${r.gps_source})`);
    console.log(`  snap: ${r.snap_street_name} (${r.snap_distance_meters}m, ${r.snap_source})`);
    console.log(`  nominatim: ${r.nominatim_street ?? '<none>'}`);
    console.log(`  resolved: ${r.resolved_address ?? '<none>'}`);
    console.log(`  user feedback: confirmed=${r.user_confirmed_block} reported_side=${r.user_reported_side} street_ok=${r.street_correct} side_ok=${r.side_correct} at=${r.user_feedback_at ?? 'never'}`);
    console.log('');
  }

  // Also pull Randy's most recent confirmed Wolcott parks to see if any have feedback.
  const { data: confirmed } = await s
    .from('parking_diagnostics')
    .select('id, created_at, raw_lat, raw_lng, snap_street_name, resolved_address, user_confirmed_block, street_correct')
    .ilike('snap_street_name', '%wolcott%')
    .not('user_feedback_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(`\nWolcott rows WITH user feedback (any time, any user): ${confirmed?.length ?? 0}`);
  for (const r of confirmed ?? []) {
    console.log(`  ${r.id} ${r.created_at}: ${r.resolved_address} confirmed=${r.user_confirmed_block} street_ok=${r.street_correct}`);
  }

  // Same for Lawrence — anyone confirmed Lawrence in the same neighborhood?
  const { data: lawrence } = await s
    .from('parking_diagnostics')
    .select('id, created_at, raw_lat, raw_lng, snap_street_name, resolved_address, user_confirmed_block, street_correct')
    .ilike('snap_street_name', '%lawrence%')
    .gte('raw_lat', LAT - 0.001)
    .lte('raw_lat', LAT + 0.001)
    .gte('raw_lng', LNG - 0.001)
    .lte('raw_lng', LNG + 0.001)
    .order('created_at', { ascending: false })
    .limit(10);
  console.log(`\nLawrence rows near this coord: ${lawrence?.length ?? 0}`);
  for (const r of lawrence ?? []) {
    console.log(`  ${r.id} ${r.created_at}: ${r.resolved_address} (raw ${r.raw_lat},${r.raw_lng}) confirmed=${r.user_confirmed_block}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
