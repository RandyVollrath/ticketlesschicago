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
    // Deactivate the token — only if it belongs to the authenticated user.
    // Without the user_id check, any authenticated user could deactivate
    // another user's push token if they knew/guessed the token string.
    if (!supabaseAdmin) {
      return res.status(500).json({ success: false, error: 'Database not configured' });
    }

    const { error, count } = await supabaseAdmin
      .from('push_tokens')
      .update({ is_active: false })
      .eq('token', token)
      .eq('user_id', authUser.id);

    if (error) {
      console.error('Error deactivating push token:', error);
      return res.status(500).json({ success: false, error: 'Failed to deactivate push token' });
    }

    console.log(`✅ Push token deactivated for user ${authUser.id}`);

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Push token deactivation error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
