import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import { checkRateLimit, recordRateLimitAction, getClientIP } from '../../lib/rate-limiter';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limiting — 100 requests per minute per IP
  const clientIp = getClientIP(req);
  const rateLimitResult = await checkRateLimit(clientIp, 'api');
  if (!rateLimitResult.allowed) {
    return res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(rateLimitResult.resetIn / 1000),
    });
  }
  await recordRateLimitAction(clientIp, 'api');

  try {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available');
    }

    const { data: cameras, error } = await (supabaseAdmin as any)
      .from('camera_locations')
      .select('camera_type, address, latitude, longitude, approaches')
      .order('camera_type')
      .limit(1000);

    if (error) {
      throw new Error(error.message);
    }

    // Cache for 6 hours - data only changes weekly
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    return res.status(200).json({
      cameras: cameras || [],
      count: cameras?.length || 0,
    });

  } catch (error) {
    console.error('Failed to fetch camera locations:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
