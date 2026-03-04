/**
 * Trigger Call Alert
 *
 * Called by the mobile app (or server cron) when a parking restriction is detected
 * and the user has phone call alerts enabled. Places an automated voice call via
 * ClickSend to warn the user about an imminent ticket.
 *
 * Rate limiting: max 1 call per parking session (keyed by user_parked_vehicles.id)
 * to prevent spam from periodic rescans.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendClickSendVoiceCall } from '../../../lib/sms-service';

/** Map rule type aliases to the 5 canonical call alert preference keys. */
function mapAlertTypeToKey(alertType: string): string | null {
  const mapping: Record<string, string> = {
    street_cleaning: 'street_cleaning',
    winter_ban: 'winter_ban',
    winter_overnight_ban: 'winter_ban',
    permit_zone: 'permit_zone',
    snow_route: 'snow_route',
    snow_ban: 'snow_route',
    two_inch_snow_ban: 'snow_route',
    dot_permit: 'dot_permit',
  };
  return mapping[alertType] || null;
}

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

    const { alert_type, message, address, parking_session_id } = req.body;

    if (!alert_type || !message) {
      return res.status(400).json({ error: 'alert_type and message are required' });
    }

    // Check if user has phone call alerts enabled
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('phone_call_enabled, phone_number, call_alert_preferences')
      .eq('id', user.id)
      .single();

    if (!profile?.phone_call_enabled || !profile?.phone_number) {
      return res.status(200).json({
        success: false,
        reason: 'Phone call alerts not enabled or no phone number',
      });
    }

    // Check per-alert-type preference (defense in depth — mobile already checks)
    const callPrefs = (profile.call_alert_preferences as Record<string, { enabled: boolean; hours_before: number }>) || {};
    const alertTypeKey = mapAlertTypeToKey(alert_type);
    if (alertTypeKey && callPrefs[alertTypeKey]) {
      if (!callPrefs[alertTypeKey].enabled) {
        return res.status(200).json({
          success: false,
          reason: `Call alerts disabled for ${alertTypeKey}`,
        });
      }
    }

    // Rate limit: check if we already called for this parking session
    if (parking_session_id) {
      const { data: existingCall } = await supabaseAdmin
        .from('parking_call_alerts')
        .select('id')
        .eq('user_id', user.id)
        .eq('parking_session_id', parking_session_id)
        .limit(1)
        .maybeSingle();

      if (existingCall) {
        console.log(`Skipping duplicate call alert for user ${user.id}, session ${parking_session_id}`);
        return res.status(200).json({
          success: false,
          reason: 'Already called for this parking session',
        });
      }
    }

    // Also rate limit: no more than 1 call per hour per user
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: recentCalls } = await supabaseAdmin
      .from('parking_call_alerts')
      .select('id')
      .eq('user_id', user.id)
      .gte('called_at', oneHourAgo)
      .limit(1);

    if (recentCalls && recentCalls.length > 0) {
      console.log(`Skipping call alert for user ${user.id} — already called within the last hour`);
      return res.status(200).json({
        success: false,
        reason: 'Already called within the last hour',
      });
    }

    // Place the call
    const voiceMessage = `Autopilot parking alert. ${message}. This is an automated call from Autopilot America.`;

    console.log(`Placing call alert to ${profile.phone_number} for user ${user.id}: ${alert_type}`);
    const callResult = await sendClickSendVoiceCall(profile.phone_number, voiceMessage);

    // Log the call attempt
    await supabaseAdmin
      .from('parking_call_alerts')
      .insert({
        user_id: user.id,
        phone_number: profile.phone_number,
        alert_type,
        message: voiceMessage,
        address: address || null,
        parking_session_id: parking_session_id || null,
        success: callResult.success,
        error: callResult.error || null,
      })
      .then(r => {
        if (r.error) console.error('Failed to log call alert:', r.error);
      });

    if (callResult.success) {
      console.log(`Call alert sent successfully to ${profile.phone_number}`);
      return res.status(200).json({ success: true });
    } else {
      console.error(`Call alert failed for user ${user.id}:`, callResult.error);
      return res.status(200).json({
        success: false,
        reason: `Call failed: ${callResult.error}`,
      });
    }
  } catch (error) {
    console.error('Error in trigger-call-alert:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
