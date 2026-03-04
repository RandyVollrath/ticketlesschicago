/**
 * Update Call Alert Settings
 *
 * Syncs the user's phone call alert preferences from the mobile app to the server.
 * Stores phone_call_enabled and phone_number on user_profiles.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

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

    const { phone_call_enabled, phone_number } = req.body;

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

    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        phone_call_enabled,
        phone_number: normalizedPhone,
      })
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
