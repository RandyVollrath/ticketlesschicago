import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, token } = req.body;

  // Validate input
  if (!userId && !token) {
    return res.status(400).json({ error: 'userId or token required' });
  }

  try {
    let targetUserId = userId;

    // If token provided, verify it and get userId
    if (token && !userId) {
      // TODO: Implement token verification for email links
      // For now, we'll just use the direct userId approach from settings page
      return res.status(400).json({ error: 'Token-based confirmation not yet implemented' });
    }

    // Update profile_confirmed_at timestamp
    const { error } = await supabase
      .from('user_profiles')
      .update({ profile_confirmed_at: new Date().toISOString() })
      .eq('user_id', targetUserId);

    if (error) {
      console.error('Error confirming profile:', error);
      return res.status(500).json({ error: 'Failed to confirm profile' });
    }

    console.log(`✅ Profile confirmed for user ${targetUserId}`);

    return res.status(200).json({
      success: true,
      message: 'Profile confirmed successfully'
    });

  } catch (error: any) {
    console.error('Profile confirmation error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
