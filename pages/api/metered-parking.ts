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

    // Supabase defaults to 1000 row limit — fetch all ~4,312 active meters
    // by paginating in chunks of 1000
    let allMeters: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await (supabaseAdmin as any)
        .from('metered_parking_locations')
        .select('meter_id, address, latitude, longitude, spaces, status, meter_type, ' +
          'street_name, direction, block_start, block_end, time_limit_hours, rate, rate_description, is_clz')
        .eq('status', 'Active')
        .order('meter_id')
        .range(offset, offset + pageSize - 1);

      if (pageError) {
        throw new Error(pageError.message);
      }

      if (!page || page.length === 0) break;
      allMeters = allMeters.concat(page);
      if (page.length < pageSize) break; // Last page
      offset += pageSize;
    }

    // Cache for 6 hours - data rarely changes (awaiting FOIA for updates)
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    return res.status(200).json({
      meters: allMeters,
      count: allMeters.length,
    });

  } catch (error) {
    console.error('Failed to fetch metered parking locations:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
