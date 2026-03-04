/**
 * Sync DOT Permits Cron Job
 *
 * Fetches active/upcoming Chicago DOT permits from the SODA API
 * and upserts them into the dot_permits table.
 *
 * Runs daily at 5 AM CT.
 *
 * Only syncs permits that:
 * - Have parking_meter_bagging = 'Y' OR street_closure IS NOT NULL
 * - Have start_date within the next 60 days (or already active)
 * - Have status = 'Open'
 * - Have latitude/longitude coordinates
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

const SODA_API_URL = 'https://data.cityofchicago.org/resource/pubx-yq2d.json';

interface SodaPermitRecord {
  uniquekey?: string;
  applicationnumber?: string;
  applicationname?: string;
  applicationtype?: string;
  applicationdescription?: string;
  worktype?: string;
  worktypedescription?: string;
  applicationstatus?: string;
  applicationstartdate?: string;
  applicationenddate?: string;
  streetnumberfrom?: string;
  streetnumberto?: string;
  direction?: string;
  streetname?: string;
  suffix?: string;
  ward?: string;
  latitude?: string;
  longitude?: string;
  streetclosure?: string;
  parkingmeterpostingorbagging?: string;
  comments?: string;
  detail?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.NODE_ENV === 'production' && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  console.log('[sync-dot-permits] Starting sync...');

  try {
    // Fetch permits from SODA API
    // Get open permits with parking impact, starting from yesterday through 60 days out
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    const sixtyDaysOut = new Date();
    sixtyDaysOut.setDate(sixtyDaysOut.getDate() + 60);
    const sixtyDaysStr = sixtyDaysOut.toISOString().split('T')[0];

    // Build SODA query
    // Fetch permits that affect parking (meter bagging or street closure)
    // with coordinates, that are open, and within our date window
    const whereClause = [
      `applicationstatus='Open'`,
      `applicationenddate>='${yesterdayStr}'`,
      `applicationstartdate<='${sixtyDaysStr}'`,
      `latitude IS NOT NULL`,
      `(parkingmeterpostingorbagging='Y' OR streetclosure IS NOT NULL)`,
    ].join(' AND ');

    const selectFields = [
      'applicationnumber', 'applicationname', 'worktypedescription',
      'applicationstatus', 'applicationstartdate', 'applicationenddate',
      'streetnumberfrom', 'streetnumberto', 'direction', 'streetname', 'suffix',
      'ward', 'latitude', 'longitude', 'streetclosure',
      'parkingmeterpostingorbagging', 'comments',
    ].join(',');

    let allRecords: SodaPermitRecord[] = [];
    let offset = 0;
    const limit = 1000;

    // Paginate through all results
    while (true) {
      const url = `${SODA_API_URL}?$where=${encodeURIComponent(whereClause)}&$select=${selectFields}&$limit=${limit}&$offset=${offset}&$order=applicationstartdate ASC`;

      console.log(`[sync-dot-permits] Fetching offset=${offset}...`);
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[sync-dot-permits] SODA API error: ${response.status} ${errorText}`);
        throw new Error(`SODA API returned ${response.status}: ${errorText}`);
      }

      const records: SodaPermitRecord[] = await response.json();
      console.log(`[sync-dot-permits] Got ${records.length} records at offset ${offset}`);

      if (records.length === 0) break;

      allRecords = allRecords.concat(records);
      offset += limit;

      // Safety limit — shouldn't have more than 10k active permits with parking impact
      if (offset > 10000) {
        console.warn('[sync-dot-permits] Hit safety limit at 10k records');
        break;
      }
    }

    console.log(`[sync-dot-permits] Total records fetched: ${allRecords.length}`);

    if (allRecords.length === 0) {
      return res.status(200).json({ success: true, message: 'No permits found', stats: { fetched: 0 } });
    }

    // Transform to database format
    const now = new Date().toISOString();
    const dbRecords = allRecords
      .filter(r => r.applicationnumber && r.applicationstartdate && r.applicationenddate)
      .map(r => {
        const lat = parseFloat(r.latitude || '');
        const lng = parseFloat(r.longitude || '');
        const hasCoords = !isNaN(lat) && !isNaN(lng);

        return {
          application_number: r.applicationnumber!,
          work_type: categorizeWorkType(r.worktypedescription || ''),
          work_description: r.worktypedescription || null,
          start_date: r.applicationstartdate!,
          end_date: r.applicationenddate!,
          street_number_from: r.streetnumberfrom ? parseInt(r.streetnumberfrom, 10) || null : null,
          street_number_to: r.streetnumberto ? parseInt(r.streetnumberto, 10) || null : null,
          direction: r.direction || null,
          street_name: r.streetname || null,
          suffix: r.suffix || null,
          latitude: hasCoords ? lat : null,
          longitude: hasCoords ? lng : null,
          // PostGIS point — formatted as WKT for Supabase insert
          location: hasCoords ? `POINT(${lng} ${lat})` : null,
          street_closure: r.streetclosure || null,
          parking_meter_bagging: r.parkingmeterpostingorbagging === 'Y',
          ward: r.ward || null,
          comments: r.comments || null,
          application_status: r.applicationstatus || 'Open',
          application_name: r.applicationname || null,
          synced_at: now,
        };
      });

    console.log(`[sync-dot-permits] Upserting ${dbRecords.length} records...`);

    // Upsert in batches of 100
    let upserted = 0;
    let errors = 0;
    const batchSize = 100;

    for (let i = 0; i < dbRecords.length; i += batchSize) {
      const batch = dbRecords.slice(i, i + batchSize);

      const { error: upsertError } = await supabaseAdmin
        .from('dot_permits')
        .upsert(batch, {
          onConflict: 'application_number',
          ignoreDuplicates: false,
        });

      if (upsertError) {
        console.error(`[sync-dot-permits] Upsert error (batch ${i / batchSize + 1}):`, upsertError.message);
        errors++;
      } else {
        upserted += batch.length;
      }
    }

    // Clean up expired permits (ended more than 7 days ago)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const { data: deletedData, error: deleteError } = await supabaseAdmin
      .from('dot_permits')
      .delete()
      .lt('end_date', sevenDaysAgo.toISOString())
      .select('id');

    const deleted = deletedData?.length || 0;
    if (deleteError) {
      console.error('[sync-dot-permits] Cleanup error:', deleteError.message);
    }

    const stats = {
      fetched: allRecords.length,
      upserted,
      errors,
      expiredDeleted: deleted,
    };

    console.log('[sync-dot-permits] Sync complete:', stats);

    return res.status(200).json({ success: true, stats });

  } catch (error) {
    console.error('[sync-dot-permits] Fatal error:', error);
    return res.status(500).json({
      error: 'Sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Categorize work type into user-friendly categories
 */
function categorizeWorkType(workTypeDesc: string): string {
  const desc = workTypeDesc.toLowerCase();

  if (desc.includes('moving van')) return 'Moving Van';
  if (desc.includes('filming')) return 'Filming';
  if (desc.includes('block party')) return 'Block Party';
  if (desc.includes('festival')) return 'Festival';
  if (desc.includes('athletic') || desc.includes('parade')) return 'Event';
  if (desc.includes('opening in the public way')) return 'Construction';
  if (desc.includes('work vehicles') || desc.includes('barricade')) return 'Construction';
  if (desc.includes('manhole')) return 'Utility Work';
  if (desc.includes('restoration')) return 'Restoration';
  if (desc.includes('maintenance')) return 'Maintenance';

  return 'Other';
}
