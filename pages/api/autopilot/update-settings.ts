import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Updates autopilot_settings and/or user_profiles for a user.
 * Used by the post-payment onboarding flow in /start to save:
 * - Ticket type preferences (autopilot_settings)
 * - Notification settings (autopilot_settings)
 * - Mailing address (user_profiles)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      userId,
      allowed_ticket_types,
      email_on_ticket_found,
      email_on_letter_mailed,
      email_on_approval_needed,
      mailing_address,
      mailing_city,
      mailing_state,
      mailing_zip,
      home_address_full,
    } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // ── Update autopilot_settings (ticket types + notifications) ──
    const settingsUpdates: Record<string, any> = {};

    if (Array.isArray(allowed_ticket_types)) {
      const VALID_TYPES = [
        'expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone',
        'no_standing_time_restricted', 'parking_prohibited', 'residential_permit',
        'missing_plate', 'commercial_loading', 'fire_hydrant', 'street_cleaning', 'bus_lane',
      ];
      settingsUpdates.allowed_ticket_types = allowed_ticket_types.filter((t: string) => VALID_TYPES.includes(t));
    }

    if (typeof email_on_ticket_found === 'boolean') {
      settingsUpdates.email_on_ticket_found = email_on_ticket_found;
    }
    if (typeof email_on_letter_mailed === 'boolean') {
      settingsUpdates.email_on_letter_mailed = email_on_letter_mailed;
    }
    if (typeof email_on_approval_needed === 'boolean') {
      settingsUpdates.email_on_approval_needed = email_on_approval_needed;
    }

    if (Object.keys(settingsUpdates).length > 0) {
      settingsUpdates.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('autopilot_settings')
        .update(settingsUpdates)
        .eq('user_id', userId);

      if (error) {
        console.error('Error updating autopilot settings:', error);
        // Non-fatal — continue to profile update
      }
    }

    // ── Update user_profiles (address fields) ──
    const profileUpdates: Record<string, any> = {};

    if (typeof mailing_address === 'string' && mailing_address.trim()) {
      profileUpdates.mailing_address = mailing_address.trim();
    }
    if (typeof mailing_city === 'string' && mailing_city.trim()) {
      profileUpdates.mailing_city = mailing_city.trim();
    }
    if (typeof mailing_state === 'string' && mailing_state.trim()) {
      profileUpdates.mailing_state = mailing_state.trim().toUpperCase();
    }
    if (typeof mailing_zip === 'string' && mailing_zip.trim()) {
      profileUpdates.mailing_zip = mailing_zip.trim();
    }
    if (typeof home_address_full === 'string' && home_address_full.trim()) {
      profileUpdates.home_address_full = home_address_full.trim();
    }

    if (Object.keys(profileUpdates).length > 0) {
      profileUpdates.updated_at = new Date().toISOString();
      const { error } = await supabaseAdmin
        .from('user_profiles')
        .update(profileUpdates)
        .eq('user_id', userId);

      if (error) {
        console.error('Error updating user profile:', error);
        return res.status(500).json({ error: 'Failed to update profile' });
      }
    }

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Update settings error:', error);
    return res.status(500).json({ error: error.message || 'Failed to update settings' });
  }
}
