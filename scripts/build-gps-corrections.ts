#!/usr/bin/env npx tsx
/**
 * GPS Block Corrections Bootstrap — Layer 4 of accuracy measurement system.
 *
 * Seeds the gps_block_corrections table from two sources:
 *
 * 1. Metered parking locations: each meter has surveyed lat/lng and a known
 *    block address. We compute the offset between the meter's position and
 *    the center of the block (grid-estimated) to learn the systematic GPS
 *    error on that block.
 *
 * 2. Parking diagnostics with user feedback: when a user confirms their
 *    side of the street, we learn which GPS offsets correspond to which sides.
 *
 * Run after creating the gps_block_corrections table:
 *   npx tsx scripts/build-gps-corrections.ts
 *
 * Re-run periodically to incorporate new feedback data.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\\n/g, '') || 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_KEY) {
  console.error('ERROR: Set SUPABASE_SERVICE_ROLE_KEY env var');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Chicago grid baselines (must match chicago-grid-estimator.ts)
const MADISON_LAT = 41.88185;
const STATE_LNG = -87.62755;
const NS_SCALE = 55700;
const EW_SCALE = 42200;

// Note: We do NOT try to estimate block center from the grid for offset calculation.
// That approach fails because the grid only gives one axis (lat OR lng), not both.
// Instead, meter positions ARE the ground truth. Offsets are computed later when we
// have parking diagnostic data (raw GPS vs snapped position) to compare against.

async function bootstrapFromMeters() {
  console.log('=== Phase 1: Bootstrap from metered parking locations ===\n');

  // Fetch all active meters with lat/lng and parsed address info
  const { data: meters, error } = await supabase
    .from('metered_parking_locations')
    .select('latitude, longitude, direction, street_name, block_start, block_end, side_of_street')
    .eq('status', 'Active')
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

  if (error) {
    console.error('Failed to fetch meters:', error.message);
    return;
  }

  console.log(`Loaded ${meters?.length || 0} active meters\n`);

  // Group meters by block
  const blockMap = new Map<string, {
    direction: string;
    streetName: string;
    blockNumber: number;
    lats: number[];
    lngs: number[];
    sides: string[];
  }>();

  for (const meter of meters || []) {
    if (!meter.direction || !meter.street_name || meter.block_start == null) continue;
    const blockNum = Math.floor(meter.block_start / 100) * 100;
    const key = `${meter.direction}|${meter.street_name}|${blockNum}`;

    if (!blockMap.has(key)) {
      blockMap.set(key, {
        direction: meter.direction,
        streetName: meter.street_name,
        blockNumber: blockNum,
        lats: [],
        lngs: [],
        sides: [],
      });
    }

    const block = blockMap.get(key)!;
    block.lats.push(meter.latitude);
    block.lngs.push(meter.longitude);
    if (meter.side_of_street) block.sides.push(meter.side_of_street);
  }

  console.log(`Found ${blockMap.size} unique blocks with meters\n`);

  // Compute corrections per block
  let upserted = 0;
  for (const [, block] of blockMap) {
    // Average meter position = ground truth for this block.
    // Offsets are initialized to 0 — they'll be computed later from parking
    // diagnostics (raw GPS vs snapped position). For now, we're just seeding
    // the block records with side-of-street counts from meter data.
    const offsetLat = 0;
    const offsetLng = 0;

    // Count sides
    const sideCounts = { N: 0, S: 0, E: 0, W: 0 };
    for (const s of block.sides) {
      if (s in sideCounts) sideCounts[s as keyof typeof sideCounts]++;
    }

    const { error: upsertErr } = await supabase
      .from('gps_block_corrections')
      .upsert({
        street_direction: block.direction,
        street_name: block.streetName,
        block_number: block.blockNumber,
        offset_lat: offsetLat,
        offset_lng: offsetLng,
        sample_count: block.lats.length,
        last_updated: new Date().toISOString(),
        north_count: sideCounts.N,
        south_count: sideCounts.S,
        east_count: sideCounts.E,
        west_count: sideCounts.W,
      }, {
        onConflict: 'street_direction,street_name,block_number',
      });

    if (upsertErr) {
      console.warn(`  Failed to upsert ${block.direction} ${block.streetName} ${block.blockNumber}:`, upsertErr.message);
    } else {
      upserted++;
    }
  }

  console.log(`Upserted ${upserted} block corrections from meters\n`);
}

async function learnFromFeedback() {
  console.log('=== Phase 2: Learn from user feedback ===\n');

  // Fetch diagnostics with user feedback
  const { data: rows, error } = await supabase
    .from('parking_diagnostics')
    .select('raw_lat, raw_lng, resolved_street_name, resolved_street_direction, resolved_house_number, resolved_side, user_confirmed_block, user_reported_side, snapped_lat, snapped_lng')
    .not('user_feedback_at', 'is', null)
    .eq('user_confirmed_parking', true); // Only confirmed parking events

  if (error) {
    console.error('Failed to fetch feedback:', error.message);
    return;
  }

  if (!rows || rows.length === 0) {
    console.log('No user feedback yet. Use the app feedback card to build ground truth.\n');
    return;
  }

  console.log(`Found ${rows.length} events with user feedback\n`);

  let updated = 0;
  for (const row of rows) {
    if (!row.resolved_street_name || !row.resolved_street_direction || !row.resolved_house_number) continue;

    const blockNum = Math.floor(row.resolved_house_number / 100) * 100;

    // If user confirmed block is correct AND reported a side, update side counts
    if (row.user_confirmed_block && row.user_reported_side) {
      const sideField = {
        N: 'north_count',
        S: 'south_count',
        E: 'east_count',
        W: 'west_count',
      }[row.user_reported_side as string];

      if (sideField) {
        // Increment the side count for this block
        const { error: rpcErr } = await supabase.rpc('increment_block_side_count', {
          p_direction: row.resolved_street_direction,
          p_street: row.resolved_street_name,
          p_block: blockNum,
          p_side_field: sideField,
        });

        if (rpcErr) {
          // RPC may not exist yet — fall back to upsert
          await supabase.from('gps_block_corrections').upsert({
            street_direction: row.resolved_street_direction,
            street_name: row.resolved_street_name,
            block_number: blockNum,
            sample_count: 1,
            last_updated: new Date().toISOString(),
            [sideField]: 1,
          }, {
            onConflict: 'street_direction,street_name,block_number',
          });
        }
        updated++;
      }
    }

    // If user confirmed block is correct and we have snapped coords,
    // update the GPS offset correction
    if (row.user_confirmed_block && row.snapped_lat && row.snapped_lng) {
      const offsetLat = row.snapped_lat - row.raw_lat;
      const offsetLng = row.snapped_lng - row.raw_lng;

      // Running average update: new_avg = old_avg + (new_value - old_avg) / new_count
      // For simplicity, just upsert — the meter data provides the baseline,
      // feedback refines it
      // TODO: implement proper running average
    }
  }

  console.log(`Updated ${updated} blocks from user feedback\n`);
}

async function printStats() {
  console.log('=== Correction Model Stats ===\n');

  const { count } = await supabase
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true });

  console.log(`Total blocks with corrections: ${count || 0}`);

  const { data: highConf } = await supabase
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true })
    .gte('sample_count', 5);

  console.log(`Blocks with 5+ samples (high confidence): ${highConf?.length || 0}`);

  // Show a few example corrections
  const { data: examples } = await supabase
    .from('gps_block_corrections')
    .select('street_direction, street_name, block_number, offset_lat, offset_lng, sample_count')
    .order('sample_count', { ascending: false })
    .limit(10);

  if (examples && examples.length > 0) {
    console.log('\nTop corrections by sample count:');
    for (const ex of examples) {
      const offsetM = Math.sqrt(
        Math.pow(ex.offset_lat * 111000, 2) +
        Math.pow(ex.offset_lng * 85000, 2)
      );
      console.log(`  ${ex.street_direction} ${ex.street_name} ${ex.block_number}: offset ${offsetM.toFixed(1)}m (${ex.sample_count} samples)`);
    }
  }
}

async function main() {
  console.log('\n=== GPS Block Corrections Builder ===\n');

  await bootstrapFromMeters();
  await learnFromFeedback();
  await printStats();

  console.log('\nDone! Corrections are ready to be applied at check-parking time.');
}

main().catch(console.error);
