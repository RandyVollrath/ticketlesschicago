/**
 * Import FOIA Meter Inventory into metered_parking_locations
 *
 * Source: City of Chicago Dept. of Finance FOIA F126827-020326 (March 9, 2026)
 *         Meter_Inventory_2.4.26__1_.xlsx — 4,849 payboxes
 *
 * Strategy:
 *   1. Add new columns if they don't exist (side_of_street, rate_zone, rush_hour_schedule, etc.)
 *   2. For each FOIA meter:
 *      a. If meter_id exists in DB → UPDATE with FOIA data, keep existing GPS coords
 *      b. If meter_id is new → INSERT, geocode address to get GPS coords
 *   3. Mark any DB meters NOT in FOIA as 'Removed' (they've been decommissioned)
 *
 * Usage:
 *   npx tsx scripts/import-foia-meters.ts
 */

import { createClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import * as XLSX from 'xlsx';
import * as path from 'path';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbPassword = process.env.SUPABASE_DB_PASSWORD;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Direct Postgres connection for DDL (ALTER TABLE)
// Uses the Supabase connection pooler
function getPgClient(): PgClient | null {
  if (!dbPassword) return null;
  return new PgClient({
    host: 'aws-0-us-east-1.pooler.supabase.com',
    port: 5432,
    database: 'postgres',
    user: 'postgres.dzhqolbhuqdcpngdayuq',
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
  });
}

// ---------------------------------------------------------------------------
// FOIA Excel parser
// ---------------------------------------------------------------------------

interface FoiaMeter {
  meter_id: number;
  pay_box_address: number;
  direction: string;
  street_name: string;
  street_suffix: string;
  side_of_street: string;
  spaces: number;
  rate: number;
  rate_description: string;
  time_limit_hours: number;
  rate_zone: number | null;
  rush_hour_schedule: string | null;
  sunday_schedule: string | null;
  is_seasonal: boolean;
  is_clz: boolean;
  is_lot: boolean;
  full_address: string;
}

function parseFoiaExcel(filePath: string): FoiaMeter[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets['Meter Inventory'];
  if (!ws) throw new Error('Sheet "Meter Inventory" not found');

  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const meters: FoiaMeter[] = [];

  // Skip header row
  for (let i = 1; i < rows.length; i++) {
    const [meterId, address, dir, streetName, streetSuffix, sideOfStreet, spaces, rateDesc] = rows[i];
    if (!meterId) continue;

    // Parse rate from "$X.XX" prefix
    const rateMatch = String(rateDesc || '').match(/^\$(\d+\.?\d*)/);
    const rate = rateMatch ? parseFloat(rateMatch[1]) : 0;

    // Parse POS (period of stay) — last occurrence of "N hr POS"
    const posMatch = String(rateDesc || '').match(/(\d+)\s*hr\s*POS/);
    const timeLimit = posMatch ? parseInt(posMatch[1], 10) : 2;

    // Rate zone from rate value (matches the official 7-zone map)
    let rateZone: number | null = null;
    if (rate === 0.50) rateZone = 1;
    else if (rate === 2.50) rateZone = 2;
    else if (rate === 4.75) rateZone = 3;
    else if (rate === 7.00) rateZone = 4;
    else if (rate === 14.00) rateZone = 5;

    // Rush hour windows (RH1, RH2, RH3)
    const rhMatches = String(rateDesc || '').match(/RH\d+:\s*[^,]+/g);
    const rushHourSchedule = rhMatches ? rhMatches.join('; ') : null;

    // Sunday-specific schedule (only if Mon-Sun is NOT the day range)
    let sundaySchedule: string | null = null;
    const sunMatch = String(rateDesc || '').match(/Sun\s+(\d{1,2}\s*(?:AM|PM)\s*-\s*\d{1,2}\s*(?:AM|PM))/i);
    if (sunMatch && !String(rateDesc || '').includes('Mon-Sun')) {
      sundaySchedule = `Sun ${sunMatch[1]}`;
    }

    // Seasonal (Memorial Day – Labor Day only)
    const isSeasonal = /Memorial Day|Labor Day/i.test(String(rateDesc || ''));

    // CLZ (commercial loading zone)
    const isClz = /CLZ/i.test(String(rateDesc || ''));

    // LOT (parking lot meter)
    const isLot = /LOT/i.test(String(rateDesc || ''));

    const fullAddress = `${address} ${dir} ${streetName} ${streetSuffix || ''}`.trim();

    meters.push({
      meter_id: Number(meterId),
      pay_box_address: Number(address),
      direction: String(dir || '').trim(),
      street_name: String(streetName || '').trim().toUpperCase(),
      street_suffix: String(streetSuffix || '').trim(),
      side_of_street: String(sideOfStreet || '').trim(),
      spaces: Number(spaces) || 0,
      rate,
      rate_description: String(rateDesc || ''),
      time_limit_hours: timeLimit,
      rate_zone: rateZone,
      rush_hour_schedule: rushHourSchedule,
      sunday_schedule: sundaySchedule,
      is_seasonal: isSeasonal,
      is_clz: isClz,
      is_lot: isLot,
      full_address: fullAddress,
    });
  }

  return meters;
}

// ---------------------------------------------------------------------------
// Geocoder (Nominatim — free, 1 req/sec)
// ---------------------------------------------------------------------------

async function geocodeAddress(address: string, streetName: string): Promise<{ lat: number; lng: number } | null> {
  // Build a Chicago-specific search query
  const query = `${address}, Chicago, IL`;

  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=us`,
      {
        headers: { 'User-Agent': 'TicketlessChicago/1.0 (FOIA meter import)' },
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.length === 0) return null;

    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);

    // Sanity: must be within Chicago bounds
    if (lat < 41.6 || lat > 42.1 || lng < -87.9 || lng > -87.5) return null;

    return { lat, lng };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// DB operations
// ---------------------------------------------------------------------------

async function addColumnsIfNeeded(): Promise<void> {
  const pgClient = getPgClient();
  if (!pgClient) {
    console.log('⚠ No SUPABASE_DB_PASSWORD — skipping ALTER TABLE. Columns must exist already.');
    console.log('  Set SUPABASE_DB_PASSWORD env var to auto-create columns.');
    return;
  }

  const alterStatements = [
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS side_of_street TEXT`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS rate_zone INTEGER`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS rush_hour_schedule TEXT`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS sunday_schedule TEXT`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS is_seasonal BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS is_lot BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS foia_verified BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS foia_updated_at TIMESTAMPTZ`,
    `ALTER TABLE metered_parking_locations ADD COLUMN IF NOT EXISTS pay_box_address INTEGER`,
  ];

  try {
    await pgClient.connect();
    for (const sql of alterStatements) {
      await pgClient.query(sql);
    }
    console.log('✓ Columns verified/added via Postgres');
  } catch (err: any) {
    console.error('Failed to add columns:', err.message);
    console.log('You may need to run the migration manually in Supabase SQL Editor.');
  } finally {
    await pgClient.end();
  }
}

async function getExistingMeters(): Promise<Map<number, { latitude: number; longitude: number }>> {
  const map = new Map<number, { latitude: number; longitude: number }>();
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('metered_parking_locations')
      .select('meter_id, latitude, longitude')
      .range(offset, offset + pageSize - 1);

    if (error) {
      console.error('Failed to fetch existing meters:', error.message);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      map.set(row.meter_id, { latitude: row.latitude, longitude: row.longitude });
    }

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const foiaPath = path.resolve(
    '/home/randy-vollrath/Documents/FOIA/Finance/ F126827-020326 /Meter_Inventory_2.4.26__1_.xlsx',
  );

  console.log('=== FOIA Meter Inventory Import ===');
  console.log(`Source: ${foiaPath}`);
  console.log();

  // 1. Parse FOIA Excel
  const foiaMeters = parseFoiaExcel(foiaPath);
  console.log(`Parsed ${foiaMeters.length} meters from FOIA spreadsheet`);

  // 2. Add new columns
  await addColumnsIfNeeded();

  // 3. Get existing meters (for GPS coordinates)
  const existingMeters = await getExistingMeters();
  console.log(`Existing meters in DB: ${existingMeters.size}`);

  // 4. Classify: update vs insert
  const toUpdate: FoiaMeter[] = [];
  const toInsert: FoiaMeter[] = [];
  const foiaIds = new Set<number>();

  for (const meter of foiaMeters) {
    foiaIds.add(meter.meter_id);
    if (existingMeters.has(meter.meter_id)) {
      toUpdate.push(meter);
    } else {
      toInsert.push(meter);
    }
  }

  // Find meters in DB but NOT in FOIA (decommissioned)
  const decommissioned: number[] = [];
  for (const [id] of existingMeters) {
    if (!foiaIds.has(id)) {
      decommissioned.push(id);
    }
  }

  console.log(`\n--- Plan ---`);
  console.log(`  Update existing: ${toUpdate.length}`);
  console.log(`  Insert new: ${toInsert.length}`);
  console.log(`  Mark decommissioned: ${decommissioned.length}`);
  console.log();

  // 5. Update existing meters (preserve GPS, update everything else)
  let updated = 0;
  const batchSize = 50;

  for (let i = 0; i < toUpdate.length; i += batchSize) {
    const batch = toUpdate.slice(i, i + batchSize);

    for (const meter of batch) {
      const { error } = await supabase
        .from('metered_parking_locations')
        .update({
          address: meter.full_address,
          street_name: meter.street_name,
          direction: meter.direction,
          spaces: meter.spaces,
          rate: meter.rate.toString(),
          rate_description: meter.rate_description,
          time_limit_hours: meter.time_limit_hours,
          is_clz: meter.is_clz,
          status: 'Active',
          side_of_street: meter.side_of_street,
          rate_zone: meter.rate_zone,
          rush_hour_schedule: meter.rush_hour_schedule,
          sunday_schedule: meter.sunday_schedule,
          is_seasonal: meter.is_seasonal,
          is_lot: meter.is_lot,
          foia_verified: true,
          foia_updated_at: new Date().toISOString(),
          pay_box_address: meter.pay_box_address,
          street_suffix: meter.street_suffix,
          source_updated_at: new Date().toISOString(),
        })
        .eq('meter_id', meter.meter_id);

      if (error) {
        console.error(`  Failed to update meter ${meter.meter_id}: ${error.message}`);
      } else {
        updated++;
      }
    }

    process.stdout.write(`\r  Updated: ${updated}/${toUpdate.length}`);
  }
  console.log(`\n✓ Updated ${updated} existing meters`);

  // 6. Insert new meters (need geocoding)
  let inserted = 0;
  let geocoded = 0;
  let geocodeFailed = 0;

  for (let i = 0; i < toInsert.length; i++) {
    const meter = toInsert[i];

    // Geocode to get GPS coordinates
    let lat: number | null = null;
    let lng: number | null = null;

    const coords = await geocodeAddress(meter.full_address, meter.street_name);
    if (coords) {
      lat = coords.lat;
      lng = coords.lng;
      geocoded++;
    } else {
      geocodeFailed++;
    }

    // Rate limit: 1 req/sec for Nominatim
    await new Promise(resolve => setTimeout(resolve, 1100));

    // Compute block range from address
    const blockStart = Math.floor(meter.pay_box_address / 100) * 100;
    const blockEnd = blockStart + 99;

    const { error } = await supabase.from('metered_parking_locations').insert({
      meter_id: meter.meter_id,
      address: meter.full_address,
      latitude: lat || 0,
      longitude: lng || 0,
      street_name: meter.street_name,
      direction: meter.direction,
      spaces: meter.spaces,
      rate: meter.rate.toString(),
      rate_description: meter.rate_description,
      time_limit_hours: meter.time_limit_hours,
      is_clz: meter.is_clz,
      status: 'Active',
      block_start: blockStart,
      block_end: blockEnd,
      meter_type: meter.is_clz ? 'CLZ' : 'CWT',
      side_of_street: meter.side_of_street,
      rate_zone: meter.rate_zone,
      rush_hour_schedule: meter.rush_hour_schedule,
      sunday_schedule: meter.sunday_schedule,
      is_seasonal: meter.is_seasonal,
      is_lot: meter.is_lot,
      foia_verified: true,
      foia_updated_at: new Date().toISOString(),
      pay_box_address: meter.pay_box_address,
      street_suffix: meter.street_suffix,
      source_updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error(`  Failed to insert meter ${meter.meter_id}: ${error.message}`);
    } else {
      inserted++;
    }

    process.stdout.write(
      `\r  Inserted: ${inserted}/${toInsert.length} (geocoded: ${geocoded}, failed: ${geocodeFailed})`,
    );
  }
  console.log(`\n✓ Inserted ${inserted} new meters (geocoded: ${geocoded}, no coords: ${geocodeFailed})`);

  // 7. Mark decommissioned meters
  if (decommissioned.length > 0) {
    // Process in batches (Supabase IN filter has limits)
    for (let i = 0; i < decommissioned.length; i += 100) {
      const batch = decommissioned.slice(i, i + 100);
      const { error } = await supabase
        .from('metered_parking_locations')
        .update({ status: 'Removed', source_updated_at: new Date().toISOString() })
        .in('meter_id', batch);

      if (error) {
        console.error(`  Failed to mark decommissioned batch: ${error.message}`);
      }
    }
    console.log(`✓ Marked ${decommissioned.length} meters as Removed (not in FOIA inventory)`);
  }

  // 8. Final stats
  const { count } = await supabase
    .from('metered_parking_locations')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Active');

  const { count: foiaVerified } = await supabase
    .from('metered_parking_locations')
    .select('*', { count: 'exact', head: true })
    .eq('foia_verified', true);

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`  Active meters: ${count}`);
  console.log(`  FOIA-verified: ${foiaVerified}`);
  console.log(`  Decommissioned: ${decommissioned.length}`);
  console.log(`  Source: FOIA F126827-020326 (March 9, 2026)`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
