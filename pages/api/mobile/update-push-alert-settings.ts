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
const VALID_ALERT_TYPES = ['sweeper_passed'];

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

    if (!push_alert_preferences || typeof push_alert_preferences !== 'object') {
      return res.status(400).json({ error: 'push_alert_preferences must be an object' });
    }

    // Validate — only allow known keys with boolean values
    const validated: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(push_alert_preferences)) {
      if (!VALID_ALERT_TYPES.includes(key)) continue;
      if (typeof value !== 'boolean') continue;
      validated[key] = value;
    }

    const { error: updateError } = await supabaseAdmin
      .from('user_profiles')
      .update({ push_alert_preferences: validated })
      .eq('id', user.id);

    if (updateError) {
      console.error('Error updating push alert settings:', updateError);
      return res.status(500).json({ error: 'Failed to update settings' });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in update-push-alert-settings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
