import { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * Get pre-filled signup data from token
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token } = req.query;

  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('signup_tokens')
      .select('*')
      .eq('token', token)
      .eq('used', false)
      .single();

    if (error || !data) {
      console.error('Token not found:', error);
      return res.status(404).json({ error: 'Invalid or expired token' });
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token expired' });
    }

    res.status(200).json({
      data: data.data,
      expiresAt: data.expires_at
    });
  } catch (error) {
    console.error('Error fetching token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}