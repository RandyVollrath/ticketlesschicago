import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import {
  checkRateLimit,
  recordRateLimitAction,
  getClientIP,
} from '../../../lib/rate-limiter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Reject cross-origin requests outright rather than merely omitting the
  // Allow-Origin header. The previous version processed the request even when
  // the Origin wasn't on our list — browsers couldn't read the response, but
  // a scripted caller still mutated our table.
  const origin = req.headers.origin;
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com',
    'https://www.autopilotamerica.com',
    'http://localhost:3000',
  ];
  const originOk = !origin || allowedOrigins.includes(origin);
  if (origin && !originOk) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit per IP so this can't be used to flood the pending_signups table
  // or hammer arbitrary emails into our DB.
  const ip = getClientIP(req);
  const rl = await checkRateLimit(ip, 'api');
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  await recordRateLimitAction(ip, 'api');

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
    token,
  } = req.body;

  // Basic validation — reject malformed or oversized values rather than stuff
  // them into the DB.
  const isString = (v: unknown, max: number) =>
    typeof v === 'string' && v.length > 0 && v.length <= max;
  const okString = (v: unknown, max: number) =>
    v === undefined || v === null || (typeof v === 'string' && v.length <= max);

  if (!isString(email, 255) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!isString(token, 128)) {
    return res.status(400).json({ error: 'Token required' });
  }
  if (
    !okString(firstName, 100) ||
    !okString(lastName, 100) ||
    !okString(phone, 20) ||
    !okString(licensePlate, 10) ||
    !okString(address, 500) ||
    !okString(zip, 10) ||
    !okString(vin, 17) ||
    !okString(make, 50) ||
    !okString(model, 50) ||
    !okString(citySticker, 50)
  ) {
    return res.status(400).json({ error: 'Invalid field lengths' });
  }

  try {
    console.log('[Pending Signup] Saving form data');

    // If a row already exists for this email with a different token, refuse
    // to overwrite. Prevents an attacker who guesses the victim's email from
    // clobbering their in-progress signup via onConflict:'email'.
    const { data: existing } = await supabaseAdmin!
      .from('pending_signups')
      .select('token, expires_at')
      .eq('email', email)
      .maybeSingle();

    const notExpired =
      existing?.expires_at && new Date(existing.expires_at).getTime() > Date.now();
    if (existing && notExpired && existing.token && existing.token !== token) {
      return res
        .status(409)
        .json({ error: 'Signup already in progress for this email' });
    }

    const { data, error } = await supabaseAdmin!
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
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      }, {
        onConflict: 'email',
      })
      .select();

    if (error) {
      console.error('[Pending Signup] Error:', error);
      throw error;
    }

    console.log('[Pending Signup] Saved successfully');

    return res.status(200).json({
      success: true,
      message: 'Signup data saved'
    });

  } catch (error: any) {
    console.error('[Pending Signup] Error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
