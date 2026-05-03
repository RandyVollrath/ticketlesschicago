import type { NextApiRequest, NextApiResponse } from 'next';
import {
  checkRateLimit,
  recordRateLimitAction,
  getClientIP,
} from '../../../lib/rate-limiter';

function loadAccessCodes(): Set<string> {
  const raw = process.env.PARTNER_ACCESS_CODES || '';
  return new Set(
    raw
      .split(',')
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit hard so this can't be used to enumerate codes.
  const ip = getClientIP(req);
  const rl = await checkRateLimit(ip, 'auth');
  if (!rl.allowed) {
    return res.status(429).json({ error: 'Too many attempts. Try again later.' });
  }
  await recordRateLimitAction(ip, 'auth');

  const code = ((req.body || {}).accessCode || '').toString().trim().toUpperCase();
  const codes = loadAccessCodes();
  if (codes.size === 0) {
    return res.status(500).json({ error: 'Service not configured' });
  }
  if (!code || !codes.has(code)) {
    return res.status(403).json({ valid: false });
  }
  return res.status(200).json({ valid: true });
}
