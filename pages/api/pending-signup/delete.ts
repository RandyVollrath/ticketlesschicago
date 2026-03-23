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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, token } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  // Require token to prevent unauthorized deletion of other users' signups
  if (!token) {
    return res.status(401).json({ error: 'Token is required' });
  }

  try {
    console.log('[Pending Signup] Deleting data for:', email);

    const { error } = await supabaseAdmin!
      .from('pending_signups')
      .delete()
      .eq('email', email)
      .eq('token', token);

    if (error) {
      throw error;
    }

    console.log('[Pending Signup] Deleted successfully');

    return res.status(200).json({
      success: true,
      message: 'Pending signup deleted'
    });

  } catch (error: any) {
    console.error('[Pending Signup] Error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
