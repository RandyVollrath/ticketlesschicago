/**
 * Sync Parking History API
 *
 * Receives bulk parking history from the mobile app's AsyncStorage and
 * upserts it into parking_location_history. Deduplicates by timestamp
 * proximity (5 min) so repeated syncs are safe.
 *
 * Called on every app open to guarantee local history reaches the server.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const HistoryItemSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
  timestamp: z.number(), // epoch ms
  rules: z.array(z.object({
    type: z.string(),
    message: z.string().optional(),
    severity: z.string().optional(),
  }).passthrough()).default([]),
  departure: z.object({
    confirmedAt: z.number(),
    distanceMeters: z.number(),
    isConclusive: z.boolean(),
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
});

const SyncSchema = z.object({
  items: z.array(HistoryItemSchema).max(10000),
});

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const DEDUP_DISTANCE_DEG = 0.002; // ~200m at Chicago latitude

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(
      authHeader.substring(7)
    );
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    const parseResult = SyncSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const { items } = parseResult.data;
    if (items.length === 0) {
      return res.status(200).json({ synced: 0, skipped: 0 });
    }

    // Fetch all existing history for this user to dedup against
    const { data: existing } = await supabaseAdmin
      .from('parking_location_history')
      .select('parked_at, latitude, longitude')
      .eq('user_id', user.id);

    const existingRecords = (existing || []).map(r => ({
      ts: new Date(r.parked_at).getTime(),
      lat: r.latitude,
      lng: r.longitude,
    }));

    let synced = 0;
    let skipped = 0;

    for (const item of items) {
      // Check if this item already exists (timestamp within 5 min AND location within ~200m)
      const isDuplicate = existingRecords.some(ex =>
        Math.abs(ex.ts - item.timestamp) < DEDUP_WINDOW_MS &&
        Math.abs(ex.lat - item.latitude) < DEDUP_DISTANCE_DEG &&
        Math.abs(ex.lng - item.longitude) < DEDUP_DISTANCE_DEG
      );

      if (isDuplicate) {
        skipped++;
        continue;
      }

      // Extract restriction flags from rules array
      const winterRule = item.rules.find(r => r.type === 'winter_ban');
      const snowRule = item.rules.find(r => r.type === 'snow_route');
      const cleaningRule = item.rules.find(r => r.type === 'street_cleaning');
      const permitRule = item.rules.find(r => r.type === 'permit_zone');

      const departureIso = item.departure ? new Date(item.departure.confirmedAt).toISOString() : null;

      const { error: insertError } = await supabaseAdmin
        .from('parking_location_history')
        .insert({
          user_id: user.id,
          latitude: item.latitude,
          longitude: item.longitude,
          address: item.address || `${item.latitude.toFixed(6)}, ${item.longitude.toFixed(6)}`,
          parked_at: new Date(item.timestamp).toISOString(),
          on_winter_ban_street: !!winterRule,
          winter_ban_street_name: (winterRule as any)?.streetName || null,
          on_snow_route: !!snowRule,
          snow_route_name: (snowRule as any)?.streetName || null,
          street_cleaning_date: (cleaningRule as any)?.nextDate || null,
          street_cleaning_ward: (cleaningRule as any)?.ward || null,
          street_cleaning_section: (cleaningRule as any)?.section || null,
          permit_zone: (permitRule as any)?.zoneName || null,
          permit_restriction_schedule: (permitRule as any)?.schedule || null,
          cleared_at: departureIso,
          departure_confirmed_at: departureIso,
          departure_latitude: item.departure?.latitude || null,
          departure_longitude: item.departure?.longitude || null,
          departure_distance_meters: item.departure?.distanceMeters || null,
        });

      if (insertError) {
        console.error(`sync-parking-history: insert failed for ${item.address}:`, insertError.message);
        skipped++;
      } else {
        synced++;
        // Add to existingRecords so subsequent items in this batch dedup correctly
        existingRecords.push({
          ts: item.timestamp,
          lat: item.latitude,
          lng: item.longitude,
        });
      }
    }

    console.log(`sync-parking-history: user=${user.id}, synced=${synced}, skipped=${skipped}, total=${items.length}`);

    return res.status(200).json({ synced, skipped });
  } catch (error) {
    console.error('Error in sync-parking-history:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
