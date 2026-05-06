#!/usr/bin/env tsx
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
async function main() {
  const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const ids: string[] = [];
  for (const e of ['randyvollrath@gmail.com', 'randyvollraths@gmail.com', 'thechicagoapp@gmail.com']) {
    const u = users?.users.find(x => x.email === e);
    if (u) { console.log(`${e} → ${u.id}`); ids.push(u.id); }
  }

  const { data, error } = await supabase
    .from('parking_diagnostics')
    .select('*')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(120);
  if (error) { console.error(error); return; }
  if (!data) return;
  console.log(`\nPulled ${data.length} diagnostics. Looking for Lawrence/Wolcott/Adams/Southport...`);

  for (const r of data) {
    const a = (r.resolved_address || '').toLowerCase();
    const sn = (r.snap_street_name || '').toLowerCase();
    if (!(a.includes('lawrence') || a.includes('wolcott') || sn.includes('lawrence') || sn.includes('wolcott'))) continue;
    const m = r.native_meta || {};
    console.log('═'.repeat(95));
    console.log(`id=${r.id}  ${r.created_at}  user=${r.user_id.slice(0,8)}`);
    console.log(`  resolved:        ${r.resolved_address}`);
    console.log(`  raw GPS:         (${r.raw_lat}, ${r.raw_lng}) acc=${r.raw_accuracy_meters}m`);
    console.log(`  gps_heading:     ${r.gps_heading}  compass: ${r.compass_heading} (conf ${r.compass_confidence}°)`);
    console.log(`  effective:       ${r.effective_heading}° → ${r.heading_orientation}  src=${r.heading_source}`);
    console.log(`  snap:            ${r.snap_street_name} dist=${r.snap_distance_meters}m bearing=${r.snap_bearing}`);
    console.log(`  nominatim:       ${r.nominatim_street} (${r.nominatim_orientation}) agreed=${r.nominatim_agreed} overrode=${r.nominatim_overrode}`);
    console.log(`  apple:           ${m.apple?.name ?? 'n/a'}  thoroughfare=${m.apple?.thoroughfare ?? 'n/a'}  agreed=${m.apple?.agreed_with_resolved}`);
    console.log(`  mapbox(snap):    pre_snap_winner=${m.mapbox?.pre_snap_winner}  matched=${m.mapbox?.matched_count}/${m.mapbox?.input_count}  conf=${m.mapbox?.confidence}`);
    console.log(`  mapbox_reverse:  ${m.mapbox_reverse?.full_address ?? 'n/a'}  agrees_snap=${m.mapbox_reverse?.agrees_with_snap}`);
    console.log(`  detection:       ${m.detectionSource ?? r.gps_source}  loc=${m.locationSource ?? 'n/a'}  drive=${m.drivingDurationSec}s  delay=${m.captureToServerDelaySec}s`);
    console.log(`  heading disag:   ${m.headingDisagreementDeg}  preferred=${m.headingPreferredSource}`);
    console.log(`  near_isxn=${r.near_intersection}  conf=${m.address_confidence}  needs_verify=${m.needs_verification}  walkaway=${r.walkaway_guard_fired}`);
    console.log(`  user_feedback:   confirmed_parking=${r.user_confirmed_parking} confirmed_block=${r.user_confirmed_block} side=${r.user_reported_side}`);
  }
}
main().catch(console.error);
