import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';

const CHICAGO_API_URL = 'https://data.cityofchicago.org/resource/u9xt-hiju.json';
const BATCH_SIZE = 1000;

const resend = new Resend(process.env.RESEND_API_KEY);

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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is a cron request (Vercel cron or manual with secret)
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.log('❌ Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🚀 Starting parking permit zones sync...\n');

  const startTime = new Date();
  let oldRecordCount = 0;
  let newRecordCount = 0;

  try {
    // Check database connection
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available');
    }

    // Get current record count before clearing
    const { count: oldCount } = await (supabaseAdmin as any)
      .from('parking_permit_zones')
      .select('*', { count: 'exact', head: true });

    oldRecordCount = oldCount || 0;
    console.log(`Current database has ${oldRecordCount} zones`);

    // Fetch data from Chicago API
    const zones = await fetchAllPermitZones();

    if (zones.length === 0) {
      throw new Error('No permit zones fetched from API');
    }

    newRecordCount = zones.length;

    console.log('\n🗑️  Clearing existing permit zone data...');

    // Clear existing data
    const { error: deleteError } = await (supabaseAdmin as any)
      .from('parking_permit_zones')
      .delete()
      .neq('id', 0);

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

    // Insert in batches
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

    const { error: syncError } = await (supabaseAdmin as any)
      .from('parking_permit_zones_sync')
      .insert({
        last_synced_at: new Date().toISOString(),
        total_records: zones.length,
        sync_status: 'success',
        error_message: null
      });

    if (syncError) {
      console.warn(`Warning: Failed to record sync metadata: ${syncError.message}`);
    }

    console.log('\n🎉 Sync completed successfully!');

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
    const dataChanged = oldRecordCount !== newRecordCount;
    const difference = newRecordCount - oldRecordCount;

    // Send success email
    try {
      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
        subject: dataChanged
          ? `✅ Permit Zones Synced - ${difference > 0 ? '+' : ''}${difference} zones changed`
          : '✅ Permit Zones Synced - No changes',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a; margin-bottom: 16px;">🅿️ Permit Zone Sync Completed</h2>

            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
              <p style="margin: 0; color: #166534; font-size: 16px;">
                <strong>Status:</strong> Successful ✅
              </p>
            </div>

            <h3 style="color: #1a1a1a; margin-bottom: 12px;">Sync Summary</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">Old Record Count:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${oldRecordCount.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">New Record Count:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${newRecordCount.toLocaleString()}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">Change:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${difference > 0 ? '#16a34a' : difference < 0 ? '#dc2626' : '#6b7280'};">
                  ${difference > 0 ? '+' : ''}${difference} zones
                </td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">Duration:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${duration}s</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Synced At:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${endTime.toLocaleString('en-US', { timeZone: 'America/Chicago' })} CT</td>
              </tr>
            </table>

            ${dataChanged ? `
              <div style="background-color: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; color: #92400e; font-size: 14px;">
                  <strong>⚠️ Data Changed:</strong> The permit zone database has been updated with ${Math.abs(difference)} ${difference > 0 ? 'new' : 'fewer'} zones.
                </p>
              </div>
            ` : `
              <div style="background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; color: #1e40af; font-size: 14px;">
                  <strong>ℹ️ No Changes:</strong> The permit zone database is up to date.
                </p>
              </div>
            `}

            <h3 style="color: #1a1a1a; margin-bottom: 12px;">Next Steps</h3>
            <ul style="color: #374151; line-height: 1.6; font-size: 14px;">
              <li>Next sync scheduled for next Sunday at 2 AM CT</li>
              <li>API endpoint: <code>/api/check-permit-zone</code> is using latest data</li>
              <li>All ${newRecordCount.toLocaleString()} zones are active and searchable</li>
            </ul>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">

            <p style="color: #9ca3af; font-size: 13px; margin: 0;">
              Autopilot America • Automated Permit Zone Sync
            </p>
          </div>
        `
      });
      console.log('✅ Success email sent');
    } catch (emailError) {
      console.error('❌ Failed to send success email:', emailError);
    }

    return res.status(200).json({
      success: true,
      totalRecords: zones.length,
      oldRecordCount,
      newRecordCount,
      difference,
      dataChanged,
      syncedAt: new Date().toISOString()
    });

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

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}
