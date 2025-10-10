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

  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    console.log('[Pending Signup] Deleting data for:', email);

    const { error } = await supabase
      .from('pending_signups')
      .delete()
      .eq('email', email);

    if (error) {
      throw error;
    }

    console.log('[Pending Signup] ✅ Deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Pending signup deleted'
    });

  } catch (error: any) {
    console.error('[Pending Signup] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
