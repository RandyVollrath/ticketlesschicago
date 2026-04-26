#!/usr/bin/env npx tsx
/**
 * Two answers in one probe:
 *  1. How often is the user actually flagging street_correct=false?
 *     (the floor on cross-street error rate for THIS user)
 *  2. Find any Fremont-area parking events to inspect the candidate pool.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: usersList } = await s.auth.admin.listUsers({ perPage: 1000 });
  const user = (usersList?.users || []).find(u => u.email === 'randyvollrath@gmail.com');
  if (!user) { console.error('user not found'); process.exit(1); }

  console.log('═══ Part 1: User-feedback rows for Randy (last 90 days) ═══\n');
  const { data: fb } = await s
    .from('parking_diagnostics')
    .select('created_at, resolved_address, snap_street_name, nominatim_street, street_correct, side_correct, location_error_meters, raw_lat, raw_lng, raw_accuracy_meters')
    .eq('user_id', user.id)
    .not('user_feedback_at', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);

  if (!fb?.length) {
    console.log('No user_feedback_at rows. (You haven\'t tapped Correct/Wrong/Not parked recently.)\n');
  } else {
    let streetWrong = 0, sideWrong = 0, allFb = fb.length;
    for (const r of fb) {
      const when = new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' });
      console.log(`[${when}] ${r.resolved_address}`);
      console.log(`  street_correct=${r.street_correct}  side_correct=${r.side_correct}  loc_err=${r.location_error_meters ?? '?'}m`);
      if (r.street_correct === false) streetWrong++;
      if (r.side_correct === false) sideWrong++;
    }
    console.log(`\nSummary: ${allFb} feedback events → street wrong: ${streetWrong} (${Math.round(100*streetWrong/allFb)}%), side wrong: ${sideWrong} (${Math.round(100*sideWrong/allFb)}%)\n`);
  }

  console.log('\n═══ Part 2: Any parking event near Fremont/Webster ═══\n');
  // Fremont in Lincoln Park ~ 41.91-41.93 N, -87.65 W. Webster Ave is the cross.
  const { data: nearby } = await s
    .from('parking_diagnostics')
    .select('created_at, resolved_address, snap_street_name, nominatim_street, nominatim_overrode, near_intersection, snap_candidates_count, address_confidence, raw_lat, raw_lng, raw_accuracy_meters, user_feedback_at, street_correct')
    .eq('user_id', user.id)
    .gte('raw_lat', 41.915).lte('raw_lat', 41.928)
    .gte('raw_lng', -87.658).lte('raw_lng', -87.648)
    .order('created_at', { ascending: false })
    .limit(25);

  if (!nearby?.length) {
    console.log('No events in the Lincoln Park / Fremont-Webster bounding box.\n');
  } else {
    for (const r of nearby) {
      const when = new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' });
      console.log(`[${when}] ${r.resolved_address}  conf=${r.address_confidence ?? '?'}  ${r.user_feedback_at ? `[FB: street_correct=${r.street_correct}]` : ''}`);
      console.log(`  snap=${r.snap_street_name} | nominatim=${r.nominatim_street}${r.nominatim_overrode ? ' [OVERRODE]' : ''}`);
      console.log(`  raw GPS: ${r.raw_lat?.toFixed(6)}, ${r.raw_lng?.toFixed(6)} (acc=${r.raw_accuracy_meters}m)`);

      const { data: snap } = await s.rpc('snap_to_nearest_street', {
        user_lat: r.raw_lat, user_lng: r.raw_lng, search_radius_meters: 80,
      });
      const cands = (snap || []).filter((c: any) => c.was_snapped);
      console.log(`  candidates (${cands.length}):`);
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i];
        const range = (c.l_from_addr && c.l_to_addr) ? `[${c.l_from_addr}-${c.l_to_addr}]` : '';
        console.log(`    ${i+1}. ${c.street_name} ${range} — ${c.snap_distance_meters?.toFixed(1)}m`);
      }
      console.log('');
    }
  }
})();
