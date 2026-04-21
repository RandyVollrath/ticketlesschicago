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
  // Allow-Origin header. Prior version processed any origin, only browsers
  // couldn't read the response.
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit per IP — limits brute-force token guessing against emails.
  const ip = getClientIP(req);
  const rl = await checkRateLimit(ip, 'api');
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  await recordRateLimitAction(ip, 'api');

  const { email, token } = req.query;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Require a matching token to prevent email enumeration / PII scraping
  if (!token || typeof token !== 'string') {
    return res.status(401).json({ error: 'Token is required' });
  }

  try {
    const { data, error } = await supabaseAdmin!
      .from('pending_signups')
      .select('*')
      .eq('email', email)
      .eq('token', token)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!data) {
      // Return generic error to prevent email enumeration
      return res.status(404).json({ error: 'No pending signup found' });
    }

    return res.status(200).json({
      success: true,
      data
    });

  } catch (error: any) {
    console.error('[Pending Signup] Error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
