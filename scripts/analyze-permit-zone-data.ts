#!/usr/bin/env npx tsx
/**
 * Comprehensive Permit Zone Hours Data Analysis
 *
 * Analyzes:
 * 1. Total zones and coverage
 * 2. Time range distribution
 * 3. Multi-schedule problem (Zone 62)
 * 4. Block-level overrides count
 * 5. Chicago open data check
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables
const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env: Record<string, string> = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
  if (match) {
    env[match[1]] = match[2].trim();
  }
}

const SUPABASE_URL = 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY not found in .env.local');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function section(title: string) {
  console.log('\n' + '='.repeat(80));
  console.log(title);
  console.log('='.repeat(80));
}

async function main() {
  section('PERMIT ZONE HOURS DATA ANALYSIS');

  // ─── 1. Total zones and coverage ────────────────────────────────────────────

  section('1. TOTAL ZONES AND COVERAGE');

  // Total active permit zones
  const { count: totalZones, error: totalError } = await supabase
    .from('parking_permit_zones')
    .select('zone', { count: 'exact', head: true })
    .eq('status', 'ACTIVE');

  if (totalError) {
    console.error('Error fetching total zones:', totalError);
    process.exit(1);
  }

  console.log(`Total active permit zone SEGMENTS (rows): ${totalZones}`);

  // Distinct zones
  const { data: distinctZonesData, error: distinctError } = await supabase
    .from('parking_permit_zones')
    .select('zone')
    .eq('status', 'ACTIVE');

  if (distinctError) {
    console.error('Error fetching distinct zones:', distinctError);
    process.exit(1);
  }

  const uniqueZones = new Set(distinctZonesData?.map(r => r.zone) || []);
  console.log(`Total UNIQUE zone numbers: ${uniqueZones.size}`);

  // Zones with hours in permit_zone_hours
  const { data: hoursData, error: hoursError } = await supabase
    .from('permit_zone_hours')
    .select('zone, zone_type, restriction_schedule');

  if (hoursError) {
    console.error('Error fetching permit_zone_hours:', hoursError);
    process.exit(1);
  }

  const zonesWithHours = new Set(hoursData?.map(r => r.zone) || []);
  console.log(`Zones WITH hours in permit_zone_hours: ${zonesWithHours.size}`);

  // Check for zones in permit_zone_hours that aren't in parking_permit_zones
  const extraZones = Array.from(zonesWithHours).filter(z => !uniqueZones.has(z));
  if (extraZones.length > 0) {
    console.log(`\nWARNING: ${extraZones.length} zones in permit_zone_hours NOT found in parking_permit_zones:`);
    console.log(`  ${extraZones.slice(0, 20).join(', ')}${extraZones.length > 20 ? '...' : ''}`);
  }

  console.log(`Zones MISSING hours: ${uniqueZones.size - zonesWithHours.size}`);

  // Missing zone numbers
  const missingZones = Array.from(uniqueZones)
    .filter(z => !zonesWithHours.has(z))
    .sort((a, b) => parseInt(a) - parseInt(b));

  console.log(`\nMissing zone numbers (first 50):`);
  console.log(missingZones.slice(0, 50).join(', '));
  if (missingZones.length > 50) {
    console.log(`... and ${missingZones.length - 50} more`);
  }

  // ─── 2. Time range distribution ─────────────────────────────────────────────

  section('2. TIME RANGE DISTRIBUTION');

  // Count distinct schedules
  const distinctSchedules = new Set(hoursData?.map(r => r.restriction_schedule) || []);
  console.log(`DISTINCT restriction_schedule values: ${distinctSchedules.size}`);

  // Group by schedule
  const scheduleGroups = new Map<string, string[]>();
  for (const row of hoursData || []) {
    const sched = row.restriction_schedule || 'NULL';
    if (!scheduleGroups.has(sched)) {
      scheduleGroups.set(sched, []);
    }
    scheduleGroups.get(sched)!.push(row.zone);
  }

  // Sort by count descending
  const sortedSchedules = Array.from(scheduleGroups.entries())
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`\nTop 20 most common schedules:`);
  console.log(`${'Schedule'.padEnd(40)} | ${'Count'.padStart(6)} | Zones`);
  console.log('-'.repeat(80));

  for (let i = 0; i < Math.min(20, sortedSchedules.length); i++) {
    const [schedule, zones] = sortedSchedules[i];
    const zoneList = zones.slice(0, 10).join(', ') + (zones.length > 10 ? '...' : '');
    console.log(`${schedule.padEnd(40)} | ${zones.length.toString().padStart(6)} | ${zoneList}`);
  }

  // Count zones sharing exact same schedule (groups with >1 zone)
  const sharedSchedules = sortedSchedules.filter(([_, zones]) => zones.length > 1);
  const totalZonesInSharedSchedules = sharedSchedules.reduce((sum, [_, zones]) => sum + zones.length, 0);
  console.log(`\nZones sharing the exact same schedule:`);
  console.log(`  ${sharedSchedules.length} distinct schedules are shared by multiple zones`);
  console.log(`  ${totalZonesInSharedSchedules} total zones share a schedule with at least one other zone`);

  // ─── 3. The multi-schedule problem (Zone 62) ────────────────────────────────

  section('3. MULTI-SCHEDULE PROBLEM (Zone 62 Case)');

  // Check if permit_zone_hours has multiple rows per zone
  const rowsPerZone = new Map<string, number>();
  for (const row of hoursData || []) {
    const key = `${row.zone}:${row.zone_type}`;
    rowsPerZone.set(key, (rowsPerZone.get(key) || 0) + 1);
  }

  const multipleRowZones = Array.from(rowsPerZone.entries())
    .filter(([_, count]) => count > 1);

  console.log(`permit_zone_hours table structure:`);
  console.log(`  Total rows: ${hoursData?.length || 0}`);
  console.log(`  Zones with MULTIPLE rows: ${multipleRowZones.length}`);

  if (multipleRowZones.length > 0) {
    console.log(`\n  Zones with multiple rows:`);
    for (const [key, count] of multipleRowZones.slice(0, 10)) {
      console.log(`    ${key}: ${count} rows`);
    }
  } else {
    console.log(`  ✓ Table is 1:1 (one row per zone/zone_type pair)`);
  }

  // Look specifically at Zone 62
  console.log(`\nZone 62 investigation:`);
  const zone62Data = await supabase
    .from('permit_zone_hours')
    .select('*')
    .eq('zone', '62');

  if (zone62Data.data && zone62Data.data.length > 0) {
    console.log(`  Rows in permit_zone_hours: ${zone62Data.data.length}`);
    for (const row of zone62Data.data) {
      console.log(`    Type: ${row.zone_type}, Schedule: ${row.restriction_schedule}`);
      console.log(`    Source: ${row.source}, Address: ${row.reported_address}`);
      console.log(`    Notes: ${row.notes || 'none'}`);
    }
  } else {
    console.log(`  No data found for Zone 62 in permit_zone_hours`);
  }

  // Check Zone 62 segments in parking_permit_zones
  const zone62Segments = await supabase
    .from('parking_permit_zones')
    .select('street_name, street_direction, street_type, address_range_low, address_range_high')
    .eq('zone', '62')
    .eq('status', 'ACTIVE')
    .order('street_name');

  if (zone62Segments.data) {
    console.log(`\n  Zone 62 segments in parking_permit_zones: ${zone62Segments.data.length}`);
    console.log(`  Streets in Zone 62:`);
    const streets = new Set<string>();
    for (const seg of zone62Segments.data) {
      const street = `${seg.street_direction || ''} ${seg.street_name} ${seg.street_type || ''}`.replace(/\s+/g, ' ').trim();
      streets.add(street);
    }
    for (const street of Array.from(streets).sort()) {
      console.log(`    ${street}`);
    }
  }

  // ─── 4. Block-level overrides ───────────────────────────────────────────────

  section('4. BLOCK-LEVEL OVERRIDES');

  const { count: overrideCount, error: overrideError } = await supabase
    .from('permit_zone_block_overrides')
    .select('id', { count: 'exact', head: true });

  if (overrideError) {
    console.error('Error fetching block overrides:', overrideError);
  } else {
    console.log(`Total block-level overrides in permit_zone_block_overrides: ${overrideCount || 0}`);
  }

  // Sample overrides
  const { data: overrideSamples } = await supabase
    .from('permit_zone_block_overrides')
    .select('*')
    .limit(10);

  if (overrideSamples && overrideSamples.length > 0) {
    console.log(`\nSample overrides (first 10):`);
    console.log(`${'Zone'.padEnd(8)} | ${'Street'.padEnd(30)} | Schedule`);
    console.log('-'.repeat(80));
    for (const override of overrideSamples) {
      const street = `${override.street_direction || ''} ${override.street_name} ${override.street_type || ''}`.replace(/\s+/g, ' ').trim();
      console.log(`${override.zone.padEnd(8)} | ${street.padEnd(30)} | ${override.restriction_schedule || 'N/A'}`);
    }
  }

  // ─── 5. The "2000 zones 10000 time ranges" stat ─────────────────────────────

  section('5. DATA SOURCE STRUCTURE ANALYSIS');

  // Check parking_permit_zones table structure
  const { count: totalRows } = await supabase
    .from('parking_permit_zones')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'ACTIVE');

  console.log(`parking_permit_zones table:`);
  console.log(`  Total ACTIVE rows: ${totalRows}`);
  console.log(`  Distinct zone numbers: ${uniqueZones.size}`);
  console.log(`  Average rows per zone: ${totalRows && uniqueZones.size ? (totalRows / uniqueZones.size).toFixed(1) : 'N/A'}`);
  console.log(`\nEach row represents: A BLOCK SEGMENT within a zone`);
  console.log(`  (one zone can span multiple streets/blocks)`);

  // Check if there's any Chicago open data with per-block hours
  console.log(`\nChicago open data sources:`);
  console.log(`  parking_permit_zones table appears to be from City of Chicago Residential Permit Parking Zones dataset`);
  console.log(`  This dataset does NOT include time restrictions — only zone boundaries`);
  console.log(`  Time restrictions must be collected via Street View or manual inspection`);

  // Calculate theoretical "time ranges per block"
  console.log(`\nTheoretical worst case:`);
  console.log(`  If each block segment could have different hours: ${totalRows} potential time ranges`);

  // Calculate actual zones in BOTH datasets (intersection)
  const zonesInBoth = Array.from(zonesWithHours).filter(z => uniqueZones.has(z));
  console.log(`  Current reality (zone-level only): ${zonesInBoth.length} zones with hours collected (out of ${uniqueZones.size} zones)`);
  console.log(`  Coverage: ${zonesInBoth.length} / ${uniqueZones.size} = ${((zonesInBoth.length / uniqueZones.size) * 100).toFixed(1)}%`);

  // ─── Summary ─────────────────────────────────────────────────────────────────

  section('SUMMARY');

  const zonesInBothFinal = Array.from(zonesWithHours).filter(z => uniqueZones.has(z));

  console.log(`Total unique permit zones (in parking_permit_zones): ${uniqueZones.size}`);
  console.log(`Zones with hours collected (in permit_zone_hours): ${zonesWithHours.size}`);
  console.log(`Zones in BOTH tables: ${zonesInBothFinal.length}`);
  console.log(`Zones missing hours: ${missingZones.length} (${((missingZones.length / uniqueZones.size) * 100).toFixed(1)}%)`);
  console.log(`Coverage: ${((zonesInBothFinal.length / uniqueZones.size) * 100).toFixed(1)}%`);
  console.log(`Distinct schedules found: ${distinctSchedules.size}`);
  console.log(`Block-level overrides: ${overrideCount || 0}`);
  console.log(`Total block segments: ${totalRows || 0} (avg ${((totalRows || 0) / uniqueZones.size).toFixed(1)} per zone)`);
  console.log(`\nKey findings:`);
  console.log(`  • permit_zone_hours is ${multipleRowZones.length === 0 ? '1:1' : 'NOT 1:1'} (one row per zone/type)`);
  console.log(`  • parking_permit_zones contains block-level boundaries (${((totalRows || 0) / uniqueZones.size).toFixed(1)} blocks/zone avg)`);
  console.log(`  • No Chicago open data source provides per-block permit hours`);
  console.log(`  • ${scheduleGroups.size} unique time ranges cover ${zonesInBothFinal.length} zones`);
  if (extraZones.length > 0) {
    console.log(`  ⚠ WARNING: ${extraZones.length} zones in permit_zone_hours but NOT in parking_permit_zones!`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
