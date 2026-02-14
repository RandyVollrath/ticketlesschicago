import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Chicago Open Data API endpoints
const SPEED_CAMERAS_URL = 'https://data.cityofchicago.org/resource/4i42-qv3h.json';
const RED_LIGHT_CAMERAS_URL = 'https://data.cityofchicago.org/resource/thvf-6diy.json';

const resend = new Resend(process.env.RESEND_API_KEY);

interface SpeedCameraRecord {
  id: string;
  address: string;
  first_approach?: string;
  second_approach?: string;
  latitude: string;
  longitude: string;
  go_live_date?: string;
  location_id?: string;
}

interface RedLightCameraRecord {
  intersection: string;
  first_approach?: string;
  second_approach?: string;
  third_approach?: string;
  latitude: string;
  longitude: string;
  go_live_date?: string;
}

interface CameraRow {
  camera_type: 'speed' | 'redlight';
  address: string;
  latitude: number;
  longitude: number;
  approaches: string[];
  go_live_date: string | null;
  source_id: string | null;
  updated_at: string;
}

function parseApproaches(...fields: (string | undefined)[]): string[] {
  return fields.filter((f): f is string => !!f && f.trim().length > 0);
}

async function fetchAllRecords<T>(baseUrl: string, label: string): Promise<T[]> {
  const BATCH_SIZE = 1000;
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const url = `${baseUrl}?$limit=${BATCH_SIZE}&$offset=${offset}&$order=:id`;
    console.log(`   Fetching ${label}: offset ${offset}`);

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${label}: ${response.statusText}`);
    }

    const batch: T[] = await response.json();
    if (batch.length === 0) {
      hasMore = false;
    } else {
      all.push(...batch);
      offset += BATCH_SIZE;
    }
  }

  console.log(`   Fetched ${all.length} ${label}`);
  return all;
}

function transformSpeedCameras(records: SpeedCameraRecord[]): CameraRow[] {
  return records
    .filter(r => r.latitude && r.longitude)
    .map(r => ({
      camera_type: 'speed' as const,
      address: r.address,
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      approaches: parseApproaches(r.first_approach, r.second_approach),
      go_live_date: r.go_live_date ? r.go_live_date.split('T')[0] : null,
      source_id: r.location_id || r.id || null,
      updated_at: new Date().toISOString(),
    }));
}

function transformRedLightCameras(records: RedLightCameraRecord[]): CameraRow[] {
  return records
    .filter(r => r.latitude && r.longitude)
    .map(r => ({
      camera_type: 'redlight' as const,
      address: r.intersection,
      latitude: parseFloat(r.latitude),
      longitude: parseFloat(r.longitude),
      approaches: parseApproaches(r.first_approach, r.second_approach, r.third_approach),
      go_live_date: r.go_live_date ? r.go_live_date.split('T')[0] : null,
      source_id: null,
      updated_at: new Date().toISOString(),
    }));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron auth
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.log('Unauthorized cron request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('Starting camera locations sync...\n');
  const startTime = new Date();

  let oldSpeedCount = 0;
  let oldRedLightCount = 0;

  try {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available');
    }

    // Get current counts
    const { count: oldSpeed } = await (supabaseAdmin as any)
      .from('camera_locations')
      .select('*', { count: 'exact', head: true })
      .eq('camera_type', 'speed');
    oldSpeedCount = oldSpeed || 0;

    const { count: oldRedLight } = await (supabaseAdmin as any)
      .from('camera_locations')
      .select('*', { count: 'exact', head: true })
      .eq('camera_type', 'redlight');
    oldRedLightCount = oldRedLight || 0;

    console.log(`Current DB: ${oldSpeedCount} speed, ${oldRedLightCount} red light`);

    // Fetch from Chicago Open Data in parallel
    const [speedRecords, redLightRecords] = await Promise.all([
      fetchAllRecords<SpeedCameraRecord>(SPEED_CAMERAS_URL, 'speed cameras'),
      fetchAllRecords<RedLightCameraRecord>(RED_LIGHT_CAMERAS_URL, 'red light cameras'),
    ]);

    const speedCameras = transformSpeedCameras(speedRecords);
    const redLightCameras = transformRedLightCameras(redLightRecords);
    const allCameras = [...speedCameras, ...redLightCameras];

    if (allCameras.length === 0) {
      throw new Error('No cameras fetched from API');
    }

    console.log(`\nTransformed: ${speedCameras.length} speed, ${redLightCameras.length} red light`);

    // Clear existing data
    console.log('\nClearing existing camera data...');
    const { error: deleteError } = await (supabaseAdmin as any)
      .from('camera_locations')
      .delete()
      .neq('id', 0);

    if (deleteError) {
      throw new Error(`Failed to clear existing data: ${deleteError.message}`);
    }

    // Insert in batches
    const BATCH_SIZE = 200;
    console.log(`\nInserting ${allCameras.length} cameras...`);

    for (let i = 0; i < allCameras.length; i += BATCH_SIZE) {
      const batch = allCameras.slice(i, i + BATCH_SIZE);
      console.log(`   Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allCameras.length / BATCH_SIZE)}`);

      const { error: insertError } = await (supabaseAdmin as any)
        .from('camera_locations')
        .insert(batch);

      if (insertError) {
        throw new Error(`Failed to insert batch: ${insertError.message}`);
      }
    }

    console.log('All cameras inserted');

    // Record sync metadata
    const { error: syncError } = await (supabaseAdmin as any)
      .from('camera_locations_sync')
      .insert({
        last_synced_at: new Date().toISOString(),
        speed_camera_count: speedCameras.length,
        red_light_camera_count: redLightCameras.length,
        total_records: allCameras.length,
        sync_status: 'success',
        error_message: null,
      });

    if (syncError) {
      console.warn(`Warning: Failed to record sync metadata: ${syncError.message}`);
    }

    const endTime = new Date();
    const duration = Math.round((endTime.getTime() - startTime.getTime()) / 1000);

    const speedDiff = speedCameras.length - oldSpeedCount;
    const redLightDiff = redLightCameras.length - oldRedLightCount;
    const totalDiff = speedDiff + redLightDiff;
    const dataChanged = totalDiff !== 0;

    console.log(`\nSync completed in ${duration}s`);

    // Send email notification
    try {
      await resend.emails.send({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: ['randyvollrath@gmail.com', 'ticketlessamerica@gmail.com'],
        subject: dataChanged
          ? `Camera Locations Synced - ${totalDiff > 0 ? '+' : ''}${totalDiff} cameras changed`
          : 'Camera Locations Synced - No changes',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a; margin-bottom: 16px;">Camera Location Sync Completed</h2>

            <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
              <p style="margin: 0; color: #166534; font-size: 16px;">
                <strong>Status:</strong> Successful
              </p>
            </div>

            <h3 style="color: #1a1a1a; margin-bottom: 12px;">Speed Cameras</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">Previous Count:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${oldSpeedCount}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">New Count:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${speedCameras.length}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Change:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${speedDiff > 0 ? '#16a34a' : speedDiff < 0 ? '#dc2626' : '#6b7280'};">
                  ${speedDiff > 0 ? '+' : ''}${speedDiff}
                </td>
              </tr>
            </table>

            <h3 style="color: #1a1a1a; margin-bottom: 12px;">Red Light Cameras</h3>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">Previous Count:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${oldRedLightCount}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">New Count:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${redLightCameras.length}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Change:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; color: ${redLightDiff > 0 ? '#16a34a' : redLightDiff < 0 ? '#dc2626' : '#6b7280'};">
                  ${redLightDiff > 0 ? '+' : ''}${redLightDiff}
                </td>
              </tr>
            </table>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
              <tr style="border-bottom: 1px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #6b7280;">Total Cameras:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${allCameras.length}</td>
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
                  <strong>Data Changed:</strong> Camera locations have been updated. The mobile app will pick up the new data on next launch.
                </p>
              </div>
            ` : `
              <div style="background-color: #eff6ff; border: 1px solid #dbeafe; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
                <p style="margin: 0; color: #1e40af; font-size: 14px;">
                  <strong>No Changes:</strong> Camera locations are up to date.
                </p>
              </div>
            `}

            <h3 style="color: #1a1a1a; margin-bottom: 12px;">Next Steps</h3>
            <ul style="color: #374151; line-height: 1.6; font-size: 14px;">
              <li>Next sync scheduled for next Sunday at 2 AM CT (with permit zones)</li>
              <li>Mobile app will fetch updated camera locations on next launch</li>
            </ul>

            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
            <p style="color: #9ca3af; font-size: 13px; margin: 0;">
              Autopilot America - Automated Camera Location Sync
            </p>
          </div>
        `,
      });
      console.log('Success email sent');
    } catch (emailError) {
      console.error('Failed to send success email:', emailError);
    }

    return res.status(200).json({
      success: true,
      speedCameras: speedCameras.length,
      redLightCameras: redLightCameras.length,
      totalCameras: allCameras.length,
      oldSpeedCount,
      oldRedLightCount,
      speedDiff,
      redLightDiff,
      dataChanged,
      syncedAt: new Date().toISOString(),
    });

  } catch (error: any) {
    console.error('\nSync failed:', error.message);

    // Record failure
    try {
      await (supabaseAdmin as any)?.from('camera_locations_sync').insert({
        last_synced_at: new Date().toISOString(),
        speed_camera_count: 0,
        red_light_camera_count: 0,
        total_records: 0,
        sync_status: 'failed',
        error_message: sanitizeErrorMessage(error),
      });
    } catch (logError) {
      console.error('Failed to log error to database:', logError);
    }

    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error),
    });
  }
}
