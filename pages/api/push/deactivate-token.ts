/**
 * Push Token Deactivation API
 *
 * Deactivates a push notification token (called on logout or when user disables notifications).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../../lib/supabase';

interface DeactivateTokenRequest {
  token: string;
}

interface DeactivateTokenResponse {
  success: boolean;
  error?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DeactivateTokenResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // Authenticate the caller
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabase) {
    return res.status(401).json({ success: false, error: 'Authorization required' });
  }
  const jwtToken = authHeader.substring(7);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(jwtToken);
  if (authError || !authUser) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }

  const { token } = req.body as DeactivateTokenRequest;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Push token is required' });
  }

  try {
    // Deactivate the token
    const { error } = await supabaseAdmin.rpc('deactivate_push_token', {
      p_token: token
    });

    if (error) {
      console.error('Error deactivating push token:', error);
      return res.status(500).json({ success: false, error: 'Failed to deactivate push token' });
    }

    console.log('✅ Push token deactivated');

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Push token deactivation error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
