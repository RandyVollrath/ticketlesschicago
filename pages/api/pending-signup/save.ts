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
  // Allow CORS for signup page
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    email,
    firstName,
    lastName,
    phone,
    licensePlate,
    address,
    zip,
    vin,
    make,
    model,
    citySticker,
    token
  } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    console.log('[Pending Signup] Saving form data for:', email);

    // Upsert pending signup data (update if exists, create if not)
    const { data, error } = await supabase
      .from('pending_signups')
      .upsert({
        email,
        first_name: firstName,
        last_name: lastName,
        phone,
        license_plate: licensePlate,
        address,
        zip,
        vin,
        make,
        model,
        city_sticker: citySticker,
        token,
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
      }, {
        onConflict: 'email'
      })
      .select();

    if (error) {
      console.error('[Pending Signup] Error:', error);
      throw error;
    }

    console.log('[Pending Signup] ✅ Saved successfully');

    return res.status(200).json({
      success: true,
      message: 'Signup data saved'
    });

  } catch (error: any) {
    console.error('[Pending Signup] Error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
