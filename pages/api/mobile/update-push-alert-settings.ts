/**
 * Update Push Alert Settings
 *
 * Syncs per-type push notification preferences from the mobile app to the server.
 * Stores them as JSONB in user_profiles.push_alert_preferences so server-side
 * crons (e.g. sweeper-passed) can respect user opt-outs.
 *
 * Payload: { push_alert_preferences: { sweeper_passed: boolean, ... } }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

// Alert types that can be toggled from the mobile app
const VALID_ALERT_TYPES = [
  'sweeper_passed',
  'street_cleaning',
  'winter_ban',
  'snow_route',
  'permit_zone',
  'dot_permit',
  'meter_max_expiring',
  'meter_zone_active',
  'city_sticker',
  'license_plate',
];

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

    const { push_alert_preferences } = req.body;

    if (!push_alert_preferences || typeof push_alert_preferences !== 'object' || Array.isArray(push_alert_preferences)) {
      return res.status(400).json({ error: 'push_alert_preferences must be an object' });
    }

    // Validate — only allow known keys with boolean values
    const validated: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(push_alert_preferences)) {
      if (!VALID_ALERT_TYPES.includes(key)) continue;
      if (typeof value !== 'boolean') continue;
      validated[key] = value;
    }

    if (Object.keys(validated).length === 0) {
      return res.status(400).json({ error: 'No valid alert preferences provided' });
    }

    // Fetch existing preferences so we MERGE (not replace) — prevents data loss
    // when the user toggles one alert type and we have other types stored.
    let existing: Record<string, boolean> = {};
    const { data: profile, error: readError } = await supabaseAdmin
      .from('user_profiles')
      .select('push_alert_preferences')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError) {
      if (readError.code === 'PGRST116') {
        // No profile row — authenticated user without a profile is unusual but not fatal.
        // We'll create the row below. Log it so we can investigate.
        console.warn(`[update-push-alert] No profile row for user ${user.id}`);
      } else {
        // Real DB error (permission, network, column missing) — don't proceed
        console.error('[update-push-alert] Error reading profile:', readError);
        return res.status(500).json({ error: 'Failed to read preferences' });
      }
    } else if (profile?.push_alert_preferences && typeof profile.push_alert_preferences === 'object') {
      // Validate each stored value is actually a boolean before merging —
      // prevents corruption from manual DB edits propagating
      const raw = profile.push_alert_preferences as Record<string, unknown>;
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'boolean') {
          existing[key] = value;
        }
      }
    }

    const merged = { ...existing, ...validated };

    // Use UPDATE (not upsert) when the profile exists — upsert with only 2 columns
    // would create a skeletal row nulling out license_plate, phone, email, etc.
    let writeError;
    if (profile) {
      const { error } = await supabaseAdmin
        .from('user_profiles')
        .update({ push_alert_preferences: merged })
        .eq('user_id', user.id);
      writeError = error;
    } else {
      // No profile row — create one. Only user_id + push_alert_preferences will be set;
      // other columns remain at their DB defaults (not null-overwritten).
      const { error } = await supabaseAdmin
        .from('user_profiles')
        .insert({ user_id: user.id, push_alert_preferences: merged });

      // Handle race condition: two concurrent requests both found PGRST116 (no row),
      // both try to insert → unique constraint violation (23505). Retry with update.
      if (error?.code === '23505') {
        const { error: retryError } = await supabaseAdmin
          .from('user_profiles')
          .update({ push_alert_preferences: merged })
          .eq('user_id', user.id);
        writeError = retryError;
      } else {
        writeError = error;
      }
    }

    if (writeError) {
      console.error('Error updating push alert settings:', writeError);
      return res.status(500).json({ error: 'Failed to update settings' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in update-push-alert-settings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
