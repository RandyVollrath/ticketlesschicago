/**
 * Clear Parked Location API
 *
 * Called by the mobile app when a user's car reconnects.
 * Deactivates the parked location so no more reminders are sent.
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
    // Verify user authentication via Supabase JWT
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }

    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    // Deactivate all active parked locations for this user
    const { error } = await supabaseAdmin
      .from('user_parked_vehicles')
      .update({ is_active: false })
      .eq('user_id', user.id)
      .eq('is_active', true);

    if (error) {
      console.error('Error clearing parked location:', error);
      return res.status(500).json({ error: 'Failed to clear parked location' });
    }

    console.log(`Cleared parked location for user ${user.id}`);

    return res.status(200).json({
      success: true,
      message: 'Parked location cleared'
    });

  } catch (error) {
    console.error('Error in clear-parked-location:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
