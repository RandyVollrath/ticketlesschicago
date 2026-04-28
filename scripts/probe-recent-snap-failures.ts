/**
 * Probe recent parking_diagnostics rows to understand snap_far / heading_stale
 * failures from today's digest. Pulls the last 12h, prints the columns relevant
 * to root-causing snap pipeline behavior.
 *
 * Run: npx tsx scripts/probe-recent-snap-failures.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing supabase env');
  const s = createClient(url, key);

  const hours = Number(process.env.HOURS || 36);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await s
    .from('parking_diagnostics')
    .select(
      'id, created_at, user_id, raw_lat, raw_lng, raw_accuracy_meters, snap_distance_meters, snap_street_name, snap_source, nominatim_street, nominatim_overrode, nominatim_orientation, resolved_address, gps_heading, compass_heading, heading_source, gps_source, parity_forced, walkaway_guard_fired, near_intersection, heading_confirmed_snap, native_meta',
    )
    .gte('created_at', since)
    .order('created_at', { ascending: false });
  if (error) throw error;

  console.log(`# Rows since ${since}: ${rows?.length ?? 0}`);
  for (const r of rows || []) {
    const meta = r.native_meta || {};
    const mb = meta.mapbox_reverse || meta.mapbox || null;
    const al = meta.auto_label || null;
    console.log('---');
    console.log(`id=${r.id}  user=${r.user_id}  at=${r.created_at}`);
    console.log(`  coords=(${r.raw_lat}, ${r.raw_lng})  acc=${r.raw_accuracy_meters}m`);
    console.log(`  snap=${r.snap_street_name ?? '<none>'} dist=${r.snap_distance_meters}m source=${r.snap_source ?? '<n>'}`);
    console.log(`  nominatim=${r.nominatim_street ?? '<none>'} (${r.nominatim_orientation ?? '?'}) overrode=${r.nominatim_overrode} hcsnap=${r.heading_confirmed_snap}`);
    console.log(`  address=${r.resolved_address ?? '<none>'}`);
    console.log(`  heading: gps=${r.gps_heading ?? '<n>'} compass=${r.compass_heading ?? '<n>'} src=${r.heading_source ?? '<n>'}`);
    console.log(`  gps_source=${r.gps_source ?? '<n>'} near_intx=${r.near_intersection} parity_forced=${r.parity_forced} walkaway=${r.walkaway_guard_fired}`);
    if (mb) console.log(`  mapbox: ${JSON.stringify(mb).slice(0, 400)}`);
    if (al) console.log(`  auto_label: ${JSON.stringify(al).slice(0, 400)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
