/**
 * Helper functions for syncing winter parking data from Chicago Open Data Portal
 * Called from daily cron on specific dates to stay under Vercel's 20 cron limit
 */

import { supabaseAdmin } from './supabase';
import { sanitizeErrorMessage } from './error-utils';

const WINTER_BAN_API_URL = 'https://data.cityofchicago.org/resource/mcad-r2g5.json';
const SNOW_ROUTES_API_URL = 'https://data.cityofchicago.org/resource/i6k4-giaj.json';
const BATCH_SIZE = 50;

interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  errors: string[];
}

/**
 * Sync Winter Overnight Parking Ban Streets from Chicago Open Data Portal
 * Should run once per year around December 1st (start of winter ban season)
 */
export async function syncWinterBanStreets(): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  try {
    console.log('[winter-sync] Fetching winter ban streets from Chicago Open Data Portal...');
    const response = await fetch(`${WINTER_BAN_API_URL}?$limit=1000`);

    if (!response.ok) {
      throw new Error(`Chicago API error: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[winter-sync] Fetched ${data.length} winter ban street records`);

    if (!supabaseAdmin) {
      throw new Error('Database connection not available');
    }

    // Clear existing data
    const { error: deleteError } = await supabaseAdmin
      .from('winter_overnight_parking_ban_streets')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (deleteError) {
      errors.push(`Delete error: ${sanitizeErrorMessage(deleteError)}`);
    }

    // Insert new data
    for (const record of data) {
      const { error: insertError } = await supabaseAdmin
        .from('winter_overnight_parking_ban_streets')
        .insert({
          street_name: record.on_street || '',
          from_location: record.from_stree || '',
          to_location: record.to_street || '',
        });

      if (insertError) {
        errors.push(`Insert error for ${record.on_street}: ${sanitizeErrorMessage(insertError)}`);
      } else {
        recordsProcessed++;
      }
    }

    console.log(`[winter-sync] Winter ban sync complete: ${recordsProcessed} records, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      recordsProcessed,
      errors,
    };

  } catch (error) {
    console.error('[winter-sync] Winter ban sync failed:', error);
    return {
      success: false,
      recordsProcessed,
      errors: [...errors, sanitizeErrorMessage(error)],
    };
  }
}

/**
 * Sync Snow Route Parking Restrictions from Chicago Open Data Portal
 * Should run once per year around November 1st (before snow season)
 */
export async function syncSnowRoutes(): Promise<SyncResult> {
  const errors: string[] = [];
  let recordsProcessed = 0;

  try {
    console.log('[winter-sync] Fetching snow routes from Chicago Open Data Portal...');
    const allRecords: any[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await fetch(`${SNOW_ROUTES_API_URL}?$limit=1000&$offset=${offset}`);
      if (!response.ok) {
        throw new Error(`Chicago API error: ${response.status}`);
      }
      const batch = await response.json();
      if (batch.length === 0) {
        hasMore = false;
      } else {
        allRecords.push(...batch);
        offset += 1000;
      }
    }

    console.log(`[winter-sync] Fetched ${allRecords.length} snow route records`);

    if (!supabaseAdmin) {
      throw new Error('Database connection not available');
    }

    // Delete existing records
    const { error: deleteError } = await supabaseAdmin
      .from('snow_routes')
      .delete()
      .gte('id', 0);

    if (deleteError) {
      errors.push(`Delete warning: ${sanitizeErrorMessage(deleteError)}`);
    }

    // Insert new records in batches
    for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
      const batch = allRecords.slice(i, i + BATCH_SIZE);

      const insertData = batch.map((record: any) => ({
        object_id: parseInt(record.objectid) || null,
        on_street: record.on_street || '',
        from_street: record.from_stree || '',
        to_street: record.to_street || '',
        restrict_type: record.restrict_t || '',
        shape_length: parseFloat(record.shape_len) || null,
        geom: record.the_geom ? JSON.stringify(record.the_geom) : null,
      }));

      const { error: insertError, data } = await supabaseAdmin
        .from('snow_routes')
        .insert(insertData)
        .select();

      if (insertError) {
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error: ${sanitizeErrorMessage(insertError)}`);
      } else {
        recordsProcessed += data?.length || 0;
      }
    }

    console.log(`[winter-sync] Snow routes sync complete: ${recordsProcessed} records, ${errors.length} errors`);

    return {
      success: errors.length === 0,
      recordsProcessed,
      errors,
    };

  } catch (error) {
    console.error('[winter-sync] Snow routes sync failed:', error);
    return {
      success: false,
      recordsProcessed,
      errors: [...errors, sanitizeErrorMessage(error)],
    };
  }
}

/**
 * Check if today is a winter sync day and run appropriate sync
 * Call this from a daily cron job
 *
 * - November 1: Sync snow routes (before snow season)
 * - December 1: Sync winter overnight ban streets (start of ban season)
 */
export async function runSeasonalWinterSyncsIfNeeded(): Promise<{
  ran: boolean;
  syncType?: 'snow_routes' | 'winter_ban_streets';
  result?: SyncResult;
}> {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const day = now.getDate();

  // November 1: Sync snow routes
  if (month === 11 && day === 1) {
    console.log('[winter-sync] November 1st - Running snow routes sync...');
    const result = await syncSnowRoutes();
    return { ran: true, syncType: 'snow_routes', result };
  }

  // December 1: Sync winter ban streets
  if (month === 12 && day === 1) {
    console.log('[winter-sync] December 1st - Running winter ban streets sync...');
    const result = await syncWinterBanStreets();
    return { ran: true, syncType: 'winter_ban_streets', result };
  }

  return { ran: false };
}
