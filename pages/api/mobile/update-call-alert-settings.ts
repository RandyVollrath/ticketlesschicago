/**
 * Update Call Alert Settings
 *
 * Syncs the user's phone call alert preferences from the mobile app to the server.
 * Stores phone_call_enabled, phone_number, and per-alert-type call_alert_preferences
 * on user_profiles.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

const VALID_ALERT_TYPES = ['street_cleaning', 'winter_ban', 'permit_zone', 'snow_route', 'dot_permit'];
const VALID_HOURS_BEFORE = [0, 1, 2, 4, 6, 12];

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

    const { phone_call_enabled, phone_number, call_alert_preferences } = req.body;

    if (typeof phone_call_enabled !== 'boolean') {
      return res.status(400).json({ error: 'phone_call_enabled must be a boolean' });
    }

    // Normalize phone number — strip non-digits, ensure leading 1 for US
    let normalizedPhone: string | null = null;
    if (phone_number) {
      const digits = String(phone_number).replace(/\D/g, '');
      if (digits.length === 10) {
        normalizedPhone = `1${digits}`;
      } else if (digits.length === 11 && digits[0] === '1') {
        normalizedPhone = digits;
      } else {
        return res.status(400).json({ error: 'Invalid phone number — must be 10-digit US number' });
      }
    }

    // Validate per-alert-type preferences if provided
    let validatedPrefs: Record<string, { enabled: boolean; hours_before: number }> | undefined;
    if (call_alert_preferences && typeof call_alert_preferences === 'object') {
      validatedPrefs = {};
      for (const [alertType, pref] of Object.entries(call_alert_preferences)) {
        if (!VALID_ALERT_TYPES.includes(alertType)) continue;
        const p = pref as any;
        if (typeof p?.enabled !== 'boolean') continue;
        const hoursBefore = typeof p?.hours_before === 'number' && VALID_HOURS_BEFORE.includes(p.hours_before)
          ? p.hours_before : 0;
        validatedPrefs[alertType] = { enabled: p.enabled, hours_before: hoursBefore };
      }
    }

    const updateData: Record<string, any> = {
      phone_call_enabled,
      phone_number: normalizedPhone,
    };
    if (validatedPrefs) {
      updateData.call_alert_preferences = validatedPrefs;
    }

    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update(updateData)
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating call alert settings:', updateError);
      return res.status(500).json({ error: 'Failed to update settings' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in update-call-alert-settings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
