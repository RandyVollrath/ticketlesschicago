/**
 * Push Token Registration API
 *
 * Registers or updates a push notification token for a user's device.
 * Called by mobile app when user grants notification permissions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

interface RegisterTokenRequest {
  token: string;
  platform: 'ios' | 'android' | 'web';
  deviceId?: string;
  deviceName?: string;
  appVersion?: string;
}

interface RegisterTokenResponse {
  success: boolean;
  tokenId?: string;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<RegisterTokenResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Get user from Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing authorization token' });
  }

  const accessToken = authHeader.substring(7);

  try {
    // Verify the user's token
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);

    if (authError || !user) {
      return res.status(401).json({ success: false, error: 'Invalid authorization token' });
    }

    const { token, platform, deviceId, deviceName, appVersion } = req.body as RegisterTokenRequest;

    // Validate required fields
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ success: false, error: 'Push token is required' });
    }

    if (!platform || !['ios', 'android', 'web'].includes(platform)) {
      return res.status(400).json({ success: false, error: 'Valid platform is required (ios, android, web)' });
    }

    // Generate device ID if not provided
    const finalDeviceId = deviceId || `${platform}-${token.substring(0, 20)}`;

    // Register the token using our database function
    const { data, error } = await supabaseAdmin.rpc('register_push_token', {
      p_user_id: user.id,
      p_token: token,
      p_platform: platform,
      p_device_id: finalDeviceId,
      p_device_name: deviceName || null,
      p_app_version: appVersion || null
    });

    if (error) {
      console.error('Error registering push token:', error);
      return res.status(500).json({ success: false, error: 'Failed to register push token' });
    }

    console.log(`✅ Push token registered for user ${user.id} (${platform})`);

    return res.status(200).json({
      success: true,
      tokenId: data
    });

  } catch (error) {
    console.error('Push token registration error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
