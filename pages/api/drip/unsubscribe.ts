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
    // Update drip campaign status to mark as unsubscribed
    const { data, error } = await supabase
      .from('drip_campaign_status')
      .update({
        unsubscribed: true,
        unsubscribed_at: new Date().toISOString()
      })
      .eq('email', email.toLowerCase());

    if (error) {
      console.error('Error unsubscribing:', error);
      return res.status(500).json({ error: 'Failed to unsubscribe' });
    }

    // Also update user_profiles marketing_consent
    await supabase
      .from('user_profiles')
      .update({ marketing_consent: false })
      .eq('email', email.toLowerCase());

    console.log(`✅ Unsubscribed: ${email}`);

    return res.status(200).json({
      success: true,
      message: 'Successfully unsubscribed from marketing emails'
    });

  } catch (error: any) {
    console.error('Unsubscribe error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
