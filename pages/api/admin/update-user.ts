import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { user_id, updates } = req.body;

  try {
    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Supabase admin client not available' });
    }

    if (!user_id || !updates) {
      return res.status(400).json({ error: 'Missing user_id or updates' });
    }

    // Update vehicle reminder record
    const { data, error } = await supabaseAdmin
      .from('vehicle_reminders')
      .update(updates)
      .eq('user_id', user_id)
      .select();

    if (error) {
      console.error('Update error:', error);
      return res.status(500).json({ error: 'Failed to update user', details: error });
    }

    return res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data
    });

  } catch (error: any) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: error.message });
  }
}