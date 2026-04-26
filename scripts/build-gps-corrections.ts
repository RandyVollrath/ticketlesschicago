#!/usr/bin/env npx tsx
/**
 * GPS Block Corrections Builder — Layer 4 of accuracy measurement system.
 *
 * Refreshes the gps_block_corrections table by:
 *   1. Setting block_centroid_lat/lng from averaged active-meter positions.
 *   2. Learning offset_lat/lng = mean(block_centroid - raw_gps) for every
 *      metered block that has at least 3 confident-snap parking events.
 *
 * The heavy lifting is in the SQL functions added by migration
 * 20260426000000_fix_gps_bias_lookup.sql — this script just calls them and
 * prints stats. Safe to re-run; it converges as more events accumulate.
 *
 *   npx tsx scripts/build-gps-corrections.ts
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!SUPABASE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function refreshCentroids() {
  console.log('=== Phase 1: Refresh block centroids from meters ===');
  const { data, error } = await sb.rpc('refresh_block_centroids_from_meters');
  if (error) {
    console.error('refresh_block_centroids_from_meters failed:', error);
    process.exit(1);
  }
  console.log(`Touched ${data} block rows (insert + update)\n`);
}

async function refreshOffsets() {
  console.log('=== Phase 2: Learn offsets from parking diagnostics ===');
  const { data, error } = await sb.rpc('refresh_block_offsets_from_diagnostics', {
    p_min_events: 3,
    p_max_snap_distance_m: 25,
  });
  if (error) {
    console.error('refresh_block_offsets_from_diagnostics failed:', error);
    process.exit(1);
  }
  console.log(`Updated offsets on ${data} blocks (>=3 confident-snap events each)\n`);
}

async function printStats() {
  console.log('=== Correction Model Stats ===');

  const { count: total } = await sb
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true });
  console.log(`Total block rows: ${total ?? 0}`);

  const { count: withCentroid } = await sb
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true })
    .not('block_centroid_lat', 'is', null);
  console.log(`Rows with centroid: ${withCentroid ?? 0}`);

  const { count: withOffset } = await sb
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true })
    .or('offset_lat.neq.0,offset_lng.neq.0');
  console.log(`Rows with non-zero learned offset: ${withOffset ?? 0}`);

  const { data: top } = await sb
    .from('gps_block_corrections')
    .select('street_direction, street_name, block_number, offset_lat, offset_lng, sample_count')
    .or('offset_lat.neq.0,offset_lng.neq.0')
    .order('sample_count', { ascending: false })
    .limit(10);

  if (top && top.length > 0) {
    console.log('\nTop blocks by sample count:');
    for (const r of top) {
      const m = Math.sqrt(
        Math.pow(r.offset_lat * 111000, 2) +
        Math.pow(r.offset_lng * 85000, 2)
      );
      console.log(`  ${r.street_direction} ${r.street_name} ${r.block_number}: ${m.toFixed(1)}m shift (${r.sample_count} events)`);
    }
  } else {
    console.log('No learned offsets yet. Need ≥3 confident-snap parking events per metered block.');
  }
}

async function main() {
  console.log('=== GPS Block Corrections Builder ===\n');
  await refreshCentroids();
  await refreshOffsets();
  await printStats();
  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
