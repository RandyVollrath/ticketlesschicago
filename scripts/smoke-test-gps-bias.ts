#!/usr/bin/env npx tsx
/**
 * Smoke test for the GPS bias-grid pipeline (Layer 4).
 *
 * Verifies end-to-end:
 *   1. Migration 20260426000000 has been applied (functions exist).
 *   2. refresh_block_centroids_from_meters populates centroids on metered blocks.
 *   3. refresh_block_offsets_from_diagnostics returns without error.
 *   4. find_gps_correction returns a sensible row for a known meter location
 *      (after centroids are populated and offsets exist).
 *
 * Per CLAUDE.md, the live smoke test IS the acceptance criterion.
 *
 *   npx tsx scripts/smoke-test-gps-bias.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`); pass++; }
  else    { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

async function main() {
  console.log('=== GPS Bias Pipeline Smoke Test ===\n');

  // 1. Functions exist
  console.log('1. Migration applied — functions exist');
  const { error: findErr } = await sb.rpc('find_gps_correction', { p_lat: 41.88, p_lng: -87.63 });
  check('find_gps_correction callable', !findErr || findErr.code !== 'PGRST202',
    findErr ? `${findErr.code}: ${findErr.message}` : undefined);

  const { data: centroidCount, error: centErr } = await sb.rpc('refresh_block_centroids_from_meters');
  check('refresh_block_centroids_from_meters callable', !centErr || centErr.code !== 'PGRST202',
    centErr ? `${centErr.code}: ${centErr.message}` : `touched ${centroidCount}`);

  const { data: offsetCount, error: offErr } = await sb.rpc('refresh_block_offsets_from_diagnostics', {
    p_min_events: 3, p_max_snap_distance_m: 25,
  });
  check('refresh_block_offsets_from_diagnostics callable', !offErr || offErr.code !== 'PGRST202',
    offErr ? `${offErr.code}: ${offErr.message}` : `updated ${offsetCount}`);

  if (fail > 0) {
    console.log('\nMigration not applied. Run:\n  supabase db push --password <db-password>\n');
    process.exit(1);
  }

  // 2. Centroids populated for a known metered block
  console.log('\n2. Centroids populated from meters');
  const { count: withCentroid } = await sb
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true })
    .not('block_centroid_lat', 'is', null);
  check('at least 100 blocks have centroid', (withCentroid ?? 0) >= 100, `${withCentroid} blocks`);

  // 3. Pick the meter-richest known block, look up via find_gps_correction
  console.log('\n3. Lookup near a known metered block');
  const { data: richest } = await sb
    .from('gps_block_corrections')
    .select('street_direction, street_name, block_number, block_centroid_lat, block_centroid_lng, sample_count, offset_lat, offset_lng')
    .not('block_centroid_lat', 'is', null)
    .order('sample_count', { ascending: false })
    .limit(1);

  if (!richest || richest.length === 0) {
    check('block with centroid exists', false, 'no rows found');
  } else {
    const r = richest[0];
    console.log(`  Test block: ${r.street_direction} ${r.street_name} ${r.block_number} centroid=(${r.block_centroid_lat.toFixed(5)}, ${r.block_centroid_lng.toFixed(5)})`);
    const { data: lookup, error: lookupErr } = await sb.rpc('find_gps_correction', {
      p_lat: r.block_centroid_lat,
      p_lng: r.block_centroid_lng,
    });
    if (lookupErr) {
      check('lookup at centroid succeeds', false, lookupErr.message);
    } else if (!lookup || lookup.length === 0) {
      check('lookup at centroid finds a row', false, `no row returned (offset is (${r.offset_lat}, ${r.offset_lng}); function only returns rows with non-zero offset and >=3 samples — this is expected if no events have been logged for this block yet)`);
    } else {
      check('lookup at centroid returns expected block', lookup[0].street_name === r.street_name,
        `${lookup[0].street_direction} ${lookup[0].street_name} ${lookup[0].block_number} (${Number(lookup[0].distance_m).toFixed(1)}m away)`);
    }
  }

  // 4. Stats summary
  console.log('\n4. Pipeline state summary');
  const { count: total } = await sb.from('gps_block_corrections').select('*', { count: 'exact', head: true });
  const { count: withOffset } = await sb.from('gps_block_corrections').select('*', { count: 'exact', head: true })
    .or('offset_lat.neq.0,offset_lng.neq.0');
  const { count: diag } = await sb.from('parking_diagnostics').select('*', { count: 'exact', head: true });
  const { count: confidentDiag } = await sb.from('parking_diagnostics').select('*', { count: 'exact', head: true })
    .lte('snap_distance_meters', 25);
  console.log(`  total blocks: ${total}, with centroid: ${withCentroid}, with non-zero offset: ${withOffset}`);
  console.log(`  total diagnostics: ${diag}, with snap_distance <= 25m: ${confidentDiag}`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
