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

    const { lat, lng } = req.query;

    // Proximity mode: return only meters within ~200m of given coordinates
    if (lat && lng) {
      const latNum = parseFloat(lat as string);
      const lngNum = parseFloat(lng as string);
      if (isNaN(latNum) || isNaN(lngNum)) {
        return res.status(400).json({ error: 'Invalid lat/lng' });
      }
      // ~200m bounding box (0.002 degrees latitude ≈ 222m)
      const delta = 0.002;
      const { data: nearby, error: nearError } = await (supabaseAdmin as any)
        .from('metered_parking_locations')
        .select('meter_id, address, rate, rate_description, meter_type, is_clz, time_limit_hours, spaces')
        .eq('status', 'Active')
        .gte('latitude', latNum - delta)
        .lte('latitude', latNum + delta)
        .gte('longitude', lngNum - delta)
        .lte('longitude', lngNum + delta)
        .limit(20);

      if (nearError) throw new Error(nearError.message);

      res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
      return res.status(200).json({
        meters: nearby || [],
        count: (nearby || []).length,
        nearby: true,
      });
    }

    // Full mode: fetch all ~4,312 active meters by paginating in chunks of 1000
    let allMeters: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: pageError } = await (supabaseAdmin as any)
        .from('metered_parking_locations')
        .select('meter_id, address, latitude, longitude, spaces, status, meter_type, ' +
          'street_name, direction, block_start, block_end, time_limit_hours, rate, rate_description, is_clz, ' +
          'rate_zone, rush_hour_schedule, sunday_schedule, is_seasonal, is_lot, side_of_street, foia_verified')
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

    // Cache for 6 hours — data is FOIA-sourced (F126827, March 2026)
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
