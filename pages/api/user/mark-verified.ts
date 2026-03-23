import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin, supabase } from '../../../lib/supabase';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate the caller
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabase) {
    return res.status(401).json({ error: 'Authorization required' });
  }
  const token = authHeader.substring(7);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authUser) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  // Users can only mark their own email as verified
  if (authUser.id !== userId) {
    return res.status(403).json({ error: 'You can only verify your own email' });
  }

  try {
    // Mark email as verified in users table
    const { error } = await supabaseAdmin!
      .from('users')
      .update({ email_verified: true })
      .eq('id', userId);

    if (error) {
      console.error('Error marking email as verified:', error);
      return res.status(500).json({ error: 'Failed to update verification status' });
    }

    console.log('✅ Email marked as verified for user:', userId);
    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Error in mark-verified:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
