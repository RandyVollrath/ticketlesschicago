/**
 * Get Single Parking History Record API
 *
 * Retrieves a specific parking history record by ID.
 * Useful for generating evidence for ticket disputes.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../../lib/error-utils';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
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

    // Validate params
    const parseResult = ParamsSchema.safeParse(req.query);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid parking history ID' });
    }

    const { id } = parseResult.data;

    // Fetch the specific record
    const { data, error } = await supabaseAdmin
      .from('parking_location_history')
      .select('*')
      .eq('id', id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Parking record not found' });
      }
      console.error('Error fetching parking history record:', error);
      return res.status(500).json({ error: 'Failed to fetch parking record' });
    }

    if (data.address && /1019\s+w\.?\s*fullerton/i.test(data.address)) {
      return res.status(404).json({ error: 'Parking record not found' });
    }

    const sanitizedData = {
      ...data,
      permit_restriction_schedule: null,
    };

    // Calculate duration if both parked_at and cleared_at exist
    let durationMinutes: number | null = null;
    if (sanitizedData.parked_at && sanitizedData.cleared_at) {
      const parkedTime = new Date(sanitizedData.parked_at).getTime();
      const clearedTime = new Date(sanitizedData.cleared_at).getTime();
      durationMinutes = Math.round((clearedTime - parkedTime) / (1000 * 60));
    }

    // Build evidence summary for ticket disputes
    const evidenceSummary = {
      parked_at: sanitizedData.parked_at,
      cleared_at: sanitizedData.cleared_at,
      departure_confirmed_at: sanitizedData.departure_confirmed_at,
      parked_location: {
        latitude: sanitizedData.latitude,
        longitude: sanitizedData.longitude,
        address: sanitizedData.address,
      },
      departure_location: sanitizedData.departure_latitude ? {
        latitude: sanitizedData.departure_latitude,
        longitude: sanitizedData.departure_longitude,
        distance_from_parked_meters: sanitizedData.departure_distance_meters,
        accuracy_meters: sanitizedData.departure_accuracy_meters,
      } : null,
      duration_minutes: durationMinutes,
      had_departure_confirmation: !!sanitizedData.departure_confirmed_at,
    };

    return res.status(200).json({
      success: true,
      data: sanitizedData,
      evidence_summary: evidenceSummary,
    });

  } catch (error) {
    console.error('Error in parking-history/[id]:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
