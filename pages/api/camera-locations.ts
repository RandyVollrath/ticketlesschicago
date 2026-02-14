import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { sanitizeErrorMessage } from '../../lib/error-utils';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Supabase admin client not available');
    }

    const { data: cameras, error } = await (supabaseAdmin as any)
      .from('camera_locations')
      .select('camera_type, address, latitude, longitude, approaches')
      .order('camera_type');

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
