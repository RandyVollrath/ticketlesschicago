import { NextApiRequest, NextApiResponse } from 'next';
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

  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  try {
    // Mark email as verified in users table
    const { error } = await supabase
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
