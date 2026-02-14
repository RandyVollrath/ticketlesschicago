/**
 * Confirm Departure API
 *
 * Called by the mobile app ~2 minutes after the car starts (Bluetooth reconnects).
 * Records the user's location to prove they have left their parking spot.
 * This provides evidence for contesting tickets with erroneous timestamps.
 *
 * Example: User leaves at 8:50am, cop writes ticket for 9:00am.
 * The departure_confirmed_at timestamp + location proves user was gone.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Input validation schema
const ConfirmDepartureSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy_meters: z.number().min(0).max(1000).optional(),
  // Optional: ID of specific parking history record to update
  parking_history_id: z.string().uuid().optional(),
});

// Calculate distance between two coordinates in meters using Haversine formula
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify user authentication via Supabase JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Validate input
    const parseResult = ConfirmDepartureSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid input' });
    }

    const input = parseResult.data;
    const departureConfirmedAt = new Date().toISOString();

    // Find the most recent parking history record that needs departure confirmation
    // Either by specific ID or the most recent one with cleared_at but no departure
    let historyRecord;

    if (input.parking_history_id) {
      // Find specific record
      const { data, error } = await supabaseAdmin
        .from('parking_location_history')
        .select('id, latitude, longitude, parked_at, cleared_at, departure_confirmed_at')
        .eq('id', input.parking_history_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        return res.status(500).json({ error: 'Failed to load parking history record' });
      }

      if (data?.departure_confirmed_at) {
        return res.status(409).json({
          error: 'Departure already confirmed for this record',
          departure_confirmed_at: data.departure_confirmed_at
        });
      }

      historyRecord = data || null;

      // If provided ID no longer matches (or was never persisted), gracefully
      // fall back to the latest row that still needs departure confirmation.
      if (!historyRecord) {
        const { data: fallbackByNeedsDeparture, error: fallbackError } = await supabaseAdmin
          .from('parking_location_history')
          .select('id, latitude, longitude, parked_at, cleared_at, departure_confirmed_at')
          .eq('user_id', user.id)
          .not('cleared_at', 'is', null)
          .is('departure_confirmed_at', null)
          .order('cleared_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (fallbackError) {
          return res.status(500).json({ error: 'Failed to find fallback parking record' });
        }

        historyRecord = fallbackByNeedsDeparture || null;
      }
    } else {
      // Find most recent record that has cleared_at but no departure confirmation
      const { data, error } = await supabaseAdmin
        .from('parking_location_history')
        .select('id, latitude, longitude, parked_at, cleared_at, departure_confirmed_at')
        .eq('user_id', user.id)
        .not('cleared_at', 'is', null)
        .is('departure_confirmed_at', null)
        .order('cleared_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error finding parking history for departure:', error);
        return res.status(500).json({ error: 'Failed to find parking record' });
      }

      if (!data) {
        // No record needs departure confirmation - maybe try finding most recent cleared
        const { data: recentData } = await supabaseAdmin
          .from('parking_location_history')
          .select('id, latitude, longitude, parked_at, cleared_at, departure_confirmed_at')
          .eq('user_id', user.id)
          .not('cleared_at', 'is', null)
          .order('cleared_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (recentData?.departure_confirmed_at) {
          return res.status(409).json({
            error: 'Most recent parking already has departure confirmed',
            departure_confirmed_at: recentData.departure_confirmed_at
          });
        }

        return res.status(404).json({
          error: 'No parking record found that needs departure confirmation'
        });
      }

      historyRecord = data;
    }

    if (!historyRecord) {
      return res.status(404).json({
        error: 'No parking record found that needs departure confirmation'
      });
    }

    // Calculate distance from parked location to current location
    const distanceMeters = calculateDistance(
      historyRecord.latitude,
      historyRecord.longitude,
      input.latitude,
      input.longitude
    );

    // Update the parking history record with departure data
    const { error: updateError } = await supabaseAdmin
      .from('parking_location_history')
      .update({
        departure_latitude: input.latitude,
        departure_longitude: input.longitude,
        departure_confirmed_at: departureConfirmedAt,
        departure_accuracy_meters: input.accuracy_meters || null,
        departure_distance_meters: Math.round(distanceMeters),
      })
      .eq('id', historyRecord.id);

    if (updateError) {
      console.error('Error updating departure confirmation:', updateError);
      return res.status(500).json({ error: 'Failed to confirm departure' });
    }

    console.log(`Departure confirmed for user ${user.id}:`, {
      historyId: historyRecord.id,
      parkedAt: historyRecord.parked_at,
      clearedAt: historyRecord.cleared_at,
      departureConfirmedAt,
      distanceMeters: Math.round(distanceMeters),
      accuracyMeters: input.accuracy_meters,
    });

    // Determine if departure is conclusive (moved significantly from parked spot)
    const isConclusive = distanceMeters >= 50; // 50+ meters is clear evidence of movement

    return res.status(200).json({
      success: true,
      data: {
        parking_history_id: historyRecord.id,
        parked_at: historyRecord.parked_at,
        cleared_at: historyRecord.cleared_at,
        departure_confirmed_at: departureConfirmedAt,
        parked_location: {
          latitude: historyRecord.latitude,
          longitude: historyRecord.longitude,
        },
        departure_location: {
          latitude: input.latitude,
          longitude: input.longitude,
          accuracy_meters: input.accuracy_meters,
        },
        distance_from_parked_meters: Math.round(distanceMeters),
        is_conclusive: isConclusive,
      },
      message: isConclusive
        ? `Departure confirmed. You moved ${Math.round(distanceMeters)}m from your parking spot.`
        : `Departure recorded. Distance from parking spot: ${Math.round(distanceMeters)}m. Consider waiting longer for more conclusive evidence.`,
    });

  } catch (error) {
    console.error('Error in confirm-departure:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
