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

  const { email, userId } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check if email already on waitlist
    const { data: existing, error: checkError } = await supabase
      .from('protection_waitlist')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'You\'re already on the waitlist!'
      });
    }

    // Add to waitlist
    const { error: insertError } = await supabase
      .from('protection_waitlist')
      .insert({
        email,
        user_id: userId || null,
        created_at: new Date().toISOString()
      });

    if (insertError) {
      throw new Error(`Failed to join waitlist: ${insertError.message}`);
    }

    console.log('✅ User joined Protection waitlist:', email);

    return res.status(200).json({
      success: true,
      message: 'Successfully joined waitlist'
    });

  } catch (error: any) {
    console.error('Waitlist error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}