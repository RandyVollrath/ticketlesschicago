/**
 * Sync parking permit zones from Chicago Open Data Portal
 *
 * Usage:
 *   npx ts-node scripts/sync-permit-zones.ts
 *
 * This script:
 * 1. Fetches all parking permit zone data from Chicago's API
 * 2. Clears existing cached data
 * 3. Inserts fresh data into the database
 * 4. Records sync metadata
 *
 * Recommended: Run this weekly via cron job or Vercel cron
 */

import { supabaseAdmin } from '../lib/supabase';

const CHICAGO_API_URL = 'https://data.cityofchicago.org/resource/u9xt-hiju.json';
const BATCH_SIZE = 1000;

interface ChicagoPermitZone {
  row_id: string;
  status: string;
  zone: string;
  odd_even?: string;
  address_range_low: string;
  address_range_high: string;
  street_direction?: string;
  street_name: string;
  street_type?: string;
  buffer?: string;
  ward_low?: string;
  ward_high?: string;
}

async function fetchAllPermitZones(): Promise<ChicagoPermitZone[]> {
  console.log('📡 Fetching parking permit zones from Chicago Open Data...');

  const allZones: ChicagoPermitZone[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${CHICAGO_API_URL}?$limit=${BATCH_SIZE}&$offset=${offset}`;
    console.log(`   Fetching batch: offset ${offset}`);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.statusText}`);
    }

    const batch: ChicagoPermitZone[] = await response.json();

    if (batch.length === 0) {
      hasMore = false;
    } else {
      allZones.push(...batch);
      offset += BATCH_SIZE;
    }
  }

  console.log(`✅ Fetched ${allZones.length} permit zones`);
  return allZones;
}

async function syncPermitZones() {
  console.log('🚀 Starting parking permit zones sync...\n');

  try {
    // Check database connection
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available. Check SUPABASE_SERVICE_ROLE_KEY');
    }

    // Fetch data from Chicago API
    const zones = await fetchAllPermitZones();

    if (zones.length === 0) {
      throw new Error('No permit zones fetched from API');
    }

    console.log('\n🗑️  Clearing existing permit zone data...');

    // Clear existing data
    const { error: deleteError } = await (supabaseAdmin as any)
      .from('parking_permit_zones')
      .delete()
      .neq('id', 0); // Delete all rows

    if (deleteError) {
      throw new Error(`Failed to clear existing data: ${deleteError.message}`);
    }

    console.log('✅ Existing data cleared');

    console.log(`\n💾 Inserting ${zones.length} permit zones...`);

    // Transform and insert data in batches
    const transformedZones = zones.map(zone => ({
      row_id: zone.row_id,
      status: zone.status,
      zone: zone.zone,
      odd_even: zone.odd_even || null,
      address_range_low: parseInt(zone.address_range_low, 10),
      address_range_high: parseInt(zone.address_range_high, 10),
      street_direction: zone.street_direction || null,
      street_name: zone.street_name,
      street_type: zone.street_type || null,
      buffer: zone.buffer || null,
      ward_low: zone.ward_low ? parseInt(zone.ward_low, 10) : null,
      ward_high: zone.ward_high ? parseInt(zone.ward_high, 10) : null,
      updated_at: new Date().toISOString()
    }));

    // Insert in batches of 1000 to avoid payload limits
    for (let i = 0; i < transformedZones.length; i += BATCH_SIZE) {
      const batch = transformedZones.slice(i, i + BATCH_SIZE);
      console.log(`   Inserting batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(transformedZones.length / BATCH_SIZE)}`);

      const { error: insertError } = await (supabaseAdmin as any)
        .from('parking_permit_zones')
        .insert(batch);

      if (insertError) {
        throw new Error(`Failed to insert batch: ${insertError.message}`);
      }
    }

    console.log('✅ All permit zones inserted');

    // Record sync metadata
    console.log('\n📝 Recording sync metadata...');

    const { error: syncError} = await (supabaseAdmin as any)
      .from('parking_permit_zones_sync')
      .insert({
        last_synced_at: new Date().toISOString(),
        total_records: zones.length,
        sync_status: 'success',
        error_message: null
      });

    if (syncError) {
      console.warn(`Warning: Failed to record sync metadata: ${syncError.message}`);
    } else {
      console.log('✅ Sync metadata recorded');
    }

    console.log('\n🎉 Sync completed successfully!');
    console.log(`   Total zones synced: ${zones.length}`);

  } catch (error: any) {
    console.error('\n❌ Sync failed:', error.message);

    // Try to record failure in database
    try {
      await (supabaseAdmin as any)?.from('parking_permit_zones_sync').insert({
        last_synced_at: new Date().toISOString(),
        total_records: 0,
        sync_status: 'failed',
        error_message: error.message
      });
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }

    process.exit(1);
  }
}

// Run sync
syncPermitZones();
