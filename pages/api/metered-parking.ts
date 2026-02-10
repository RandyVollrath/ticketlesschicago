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

    const { data: meters, error } = await (supabaseAdmin as any)
      .from('metered_parking_locations')
      .select('meter_id, address, latitude, longitude, spaces, status, meter_type')
      .eq('status', 'Active')
      .order('meter_id');

    if (error) {
      throw new Error(error.message);
    }

    // Cache for 6 hours - data rarely changes (awaiting FOIA for updates)
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    return res.status(200).json({
      meters: meters || [],
      count: meters?.length || 0,
    });

  } catch (error) {
    console.error('Failed to fetch metered parking locations:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
