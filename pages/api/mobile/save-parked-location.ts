/**
 * Save Parked Location API
 *
 * Called by the mobile app when a user parks (car Bluetooth disconnects).
 * Stores the location and detected restrictions for follow-up reminders.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Input validation schema
const SaveParkedLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(500).optional(),
  fcm_token: z.string().min(1).max(500),

  // Restriction flags from the parking check
  on_winter_ban_street: z.boolean().default(false),
  winter_ban_street_name: z.string().max(200).optional(),
  on_snow_route: z.boolean().default(false),
  snow_route_name: z.string().max(200).optional(),
  street_cleaning_date: z.string().nullable().optional(), // ISO date string
  street_cleaning_ward: z.string().max(50).optional(),
  street_cleaning_section: z.string().max(50).optional(),
  permit_zone: z.string().max(50).nullable().optional(),
  permit_restriction_schedule: z.string().max(100).optional(),
});

type SaveParkedLocationInput = z.infer<typeof SaveParkedLocationSchema>;

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

    const userId = user.id;

    // Validate input
    const parseResult = SaveParkedLocationSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid input'
      });
    }

    const input: SaveParkedLocationInput = parseResult.data;

    // Deactivate any existing parked location for this user
    await supabaseAdmin
      .from('user_parked_vehicles')
      .update({ is_active: false })
      .eq('user_id', userId)
      .eq('is_active', true);

    // Parse street cleaning date if provided
    let streetCleaningDate: string | null = null;
    if (input.street_cleaning_date) {
      // Validate it's a valid date
      const parsed = new Date(input.street_cleaning_date);
      if (!isNaN(parsed.getTime())) {
        streetCleaningDate = parsed.toISOString().split('T')[0]; // YYYY-MM-DD
      }
    }

    const parkedAt = new Date().toISOString();
    const addressValue = input.address || `${input.latitude.toFixed(6)}, ${input.longitude.toFixed(6)}`;

    // Insert new parked location (for active parking tracking)
    const { data, error } = await supabaseAdmin
      .from('user_parked_vehicles')
      .insert({
        user_id: userId,
        latitude: input.latitude,
        longitude: input.longitude,
        address: addressValue,
        fcm_token: input.fcm_token,

        on_winter_ban_street: input.on_winter_ban_street,
        winter_ban_street_name: input.winter_ban_street_name || null,
        on_snow_route: input.on_snow_route,
        snow_route_name: input.snow_route_name || null,
        street_cleaning_date: streetCleaningDate,
        street_cleaning_ward: input.street_cleaning_ward || null,
        street_cleaning_section: input.street_cleaning_section || null,
        permit_zone: input.permit_zone || null,
        permit_restriction_schedule: input.permit_restriction_schedule || null,

        is_active: true,
        parked_at: parkedAt,
      })
      .select('id')
      .single();

    if (error) {
      console.error('Error saving parked location:', error);
      return res.status(500).json({ error: 'Failed to save parked location' });
    }

    // Also insert into parking history for permanent record
    const { error: historyError } = await supabaseAdmin
      .from('parking_location_history')
      .insert({
        user_id: userId,
        latitude: input.latitude,
        longitude: input.longitude,
        address: addressValue,

        on_winter_ban_street: input.on_winter_ban_street,
        winter_ban_street_name: input.winter_ban_street_name || null,
        on_snow_route: input.on_snow_route,
        snow_route_name: input.snow_route_name || null,
        street_cleaning_date: streetCleaningDate,
        street_cleaning_ward: input.street_cleaning_ward || null,
        street_cleaning_section: input.street_cleaning_section || null,
        permit_zone: input.permit_zone || null,
        permit_restriction_schedule: input.permit_restriction_schedule || null,

        parked_at: parkedAt,
      });

    if (historyError) {
      // Log but don't fail the request - history is secondary to active tracking
      console.error('Error saving parking history:', historyError);
    }

    // Update saved location stats if user parked at a saved location (within ~50m)
    const { data: matchingSavedLocation } = await supabaseAdmin
      .from('saved_parking_locations')
      .select('id, times_parked')
      .eq('user_id', userId)
      .gte('latitude', input.latitude - 0.0005)
      .lte('latitude', input.latitude + 0.0005)
      .gte('longitude', input.longitude - 0.0005)
      .lte('longitude', input.longitude + 0.0005)
      .limit(1)
      .maybeSingle();

    if (matchingSavedLocation) {
      await supabaseAdmin
        .from('saved_parking_locations')
        .update({
          times_parked: (matchingSavedLocation.times_parked || 0) + 1,
          last_parked_at: parkedAt,
        })
        .eq('id', matchingSavedLocation.id);
    }

    console.log(`Saved parked location for user ${userId}:`, {
      id: data.id,
      winterBan: input.on_winter_ban_street,
      snowRoute: input.on_snow_route,
      streetCleaning: streetCleaningDate,
      permitZone: input.permit_zone,
    });

    return res.status(200).json({
      success: true,
      id: data.id,
      message: 'Parked location saved. You will receive reminders before restrictions.'
    });

  } catch (error) {
    console.error('Error in save-parked-location:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
