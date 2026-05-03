#!/usr/bin/env npx tsx
/**
 * Pull diagnostic rows for the 3 specific events Randy named so we can
 * see exactly what was recorded vs what he says happened.
 */

import { createClient } from '@supabase/supabase-js';

async function pullWindow(label: string, fromIso: string, toIso: string, minLat: number, maxLat: number, minLng: number, maxLng: number) {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: rows } = await s
    .from('parking_diagnostics')
    .select('id, created_at, raw_lat, raw_lng, raw_accuracy_meters, gps_source, snap_street_name, snap_distance_meters, snap_source, nominatim_street, resolved_address, resolved_house_number, resolved_street_name, near_intersection, native_meta')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .gte('raw_lat', minLat)
    .lte('raw_lat', maxLat)
    .gte('raw_lng', minLng)
    .lte('raw_lng', maxLng)
    .order('created_at', { ascending: true });

  console.log(`\n=== ${label} ===`);
  console.log(`(${fromIso} → ${toIso} UTC, bbox ${minLat}-${maxLat} × ${minLng}-${maxLng})`);
  console.log(`Rows: ${rows?.length ?? 0}`);
  for (const r of rows ?? []) {
    const cdt = new Date(r.created_at).toLocaleString('en-US', { timeZone: 'America/Chicago' });
    console.log(`\n  row ${r.id} @ ${cdt} CDT (${r.gps_source})`);
    console.log(`    raw: ${r.raw_lat},${r.raw_lng} acc=${r.raw_accuracy_meters}m`);
    console.log(`    snap: ${r.snap_street_name} (${r.snap_distance_meters}m via ${r.snap_source}) near_intersection=${r.near_intersection}`);
    console.log(`    nominatim: ${r.nominatim_street ?? '<none>'}`);
    console.log(`    resolved: ${r.resolved_address}`);
  }
}

async function main() {
  // Event 1: 4/25 16:18 CDT = 4/25 21:18 UTC → "2030 Lawrence"
  await pullWindow(
    '4/25 16:18 CDT — "2030 W Lawrence"',
    '2026-04-25T20:00:00Z',
    '2026-04-25T22:30:00Z',
    41.967, 41.970, -87.677, -87.674,
  );

  // Event 2: 4/24 16:56 CDT = 4/24 21:56 UTC → "2032 Lawrence" Metra
  await pullWindow(
    '4/24 16:56 CDT — "2032 W Lawrence" (Randy says METRA)',
    '2026-04-24T21:30:00Z',
    '2026-04-24T22:30:00Z',
    41.967, 41.970, -87.677, -87.674,
  );

  // Event 3: 4/23 20:15-20:21 CDT = 4/24 01:15-01:21 UTC → 4755/4785 N Wolcott
  await pullWindow(
    '4/23 20:15-20:21 CDT — "4755/4785 N Wolcott" (auto then manual)',
    '2026-04-24T01:00:00Z',
    '2026-04-24T01:30:00Z',
    41.965, 41.972, -87.678, -87.674,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
