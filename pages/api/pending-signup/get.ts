import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Restrict CORS to same-origin only (no wildcard)
  const origin = req.headers.origin;
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com',
    'https://www.autopilotamerica.com',
    'http://localhost:3000',
  ];
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
