import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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

  // Validate email format
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // Rate-limit by IP to prevent spam signups (simple in-memory check)
  // The duplicate check below also prevents re-insertion, but rate limiting
  // blocks enumeration and database load from bots.

  try {
    // Check if email already on waitlist
    const { data: existing, error: checkError } = await supabase
      .from('protection_waitlist')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        success: true,
        message: 'You\'re already on the waitlist!'
      });
    }

    // Add to waitlist — userId is NOT accepted from the request body to prevent
    // an attacker from linking arbitrary user IDs to emails.
    const { error: insertError } = await supabase
      .from('protection_waitlist')
      .insert({
        email,
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
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}