/**
 * Clear Parked Location API
 *
 * Called by the mobile app when a user's car reconnects (Bluetooth reconnects).
 * Deactivates the parked location so no more reminders are sent.
 *
 * Returns the parking_history_id so the mobile app can later call
 * /api/mobile/confirm-departure to record departure location as evidence.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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

    // Deactivate all active parked locations for this user
    const { error } = await supabaseAdmin
      .from('user_parked_vehicles')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) {
      console.error('Error clearing parked location:', error);
      return res.status(500).json({ error: 'Failed to clear parked location' });
    }

    // Update parking history with cleared_at timestamp
    // First find the most recent history record without a cleared_at
    const clearedAt = new Date().toISOString();
    const { data: recentHistory, error: fetchError } = await supabaseAdmin
      .from('parking_location_history')
      .select('id, latitude, longitude, parked_at, address')
      .eq('user_id', user.id)
      .is('cleared_at', null)
      .order('parked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let parkingHistoryId: string | null = null;
    let parkedLocation: { latitude: number; longitude: number; address: string | null } | null = null;

    if (fetchError) {
      console.error('Error fetching parking history for clear:', fetchError);
    } else if (recentHistory) {
      parkingHistoryId = recentHistory.id;
      parkedLocation = {
        latitude: recentHistory.latitude,
        longitude: recentHistory.longitude,
        address: recentHistory.address,
      };

      // Update only that specific record
      const { error: historyError } = await supabaseAdmin
        .from('parking_location_history')
        .update({ cleared_at: clearedAt })
        .eq('id', recentHistory.id);

      if (historyError) {
        console.error('Error updating parking history cleared_at:', historyError);
      }
    }

    console.log(`Cleared parked location for user ${user.id}`, {
      parkingHistoryId,
      clearedAt,
    });

    return res.status(200).json({
      success: true,
      message: 'Parked location cleared',
      // Return data needed for departure confirmation
      parking_history_id: parkingHistoryId,
      cleared_at: clearedAt,
      parked_location: parkedLocation,
      // Instruct mobile app to confirm departure in ~2 minutes
      departure_confirmation_delay_ms: 120000, // 2 minutes
    });

  } catch (error) {
    console.error('Error in clear-parked-location:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
