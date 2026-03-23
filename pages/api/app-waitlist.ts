import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../lib/error-utils';

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

  const { email, phone, source } = req.body;

  // Validate email
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // Sanitize phone (optional field)
  const cleanPhone = phone && typeof phone === 'string'
    ? phone.replace(/[^\d+\-() ]/g, '').slice(0, 20)
    : null;

  // Sanitize source
  const cleanSource = source && typeof source === 'string'
    ? source.replace(/[^a-zA-Z0-9_\- ]/g, '').slice(0, 50)
    : 'website';

  try {
    // Check if email already on waitlist
    const { data: existing } = await supabase
      .from('app_waitlist')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return res.status(200).json({
        success: true,
        message: "You're already on the list! We'll reach out soon."
      });
    }

    // Insert new waitlist entry
    const { error: insertError } = await supabase
      .from('app_waitlist')
      .insert({
        email: email.toLowerCase().trim(),
        phone: cleanPhone,
        source: cleanSource,
      });

    if (insertError) {
      // Handle unique constraint violation gracefully
      if (insertError.message.includes('duplicate') || insertError.message.includes('unique')) {
        return res.status(200).json({
          success: true,
          message: "You're already on the list! We'll reach out soon."
        });
      }
      throw new Error(`Failed to join waitlist: ${insertError.message}`);
    }

    console.log('New app waitlist signup:', email.toLowerCase().trim(), cleanSource);

    return res.status(200).json({
      success: true,
      message: "You're in! We'll notify you as soon as the app launches."
    });

  } catch (error: any) {
    console.error('App waitlist error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
