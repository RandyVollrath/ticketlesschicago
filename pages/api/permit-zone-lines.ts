import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

/**
 * GET /api/permit-zone-lines
 *
 * Returns GeoJSON line features for permit zone street segments.
 *
 * Strategy (v3): Pre-computed geometries stored in permit_zone_geometries table.
 *   - 82.6% of zones use real OpenStreetMap street centerline polylines
 *     (curves, diagonals, bends all precisely mapped)
 *   - 16.9% use Nominatim-geocoded coordinates + Chicago grid math
 *   - Computed by scripts/precompute-permit-geometries.ts
 *
 * Query params:
 *   ?zone=123       — filter to a specific zone number
 *   ?bounds=N,S,E,W — filter to map viewport
 */

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  try {
    const boundsStr = req.query.bounds as string | undefined;
    const zoneFilter = req.query.zone as string | undefined;

    // Paginate the geometry table (can have >1000 rows)
    const allRows: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabaseAdmin
        .from('permit_zone_geometries')
        .select('zone, street_direction, street_name, street_type, address_range_low, address_range_high, odd_even, geometry, source');

      if (zoneFilter) {
        query = query.eq('zone', zoneFilter);
      }

      const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error('[permit-zone-lines] DB error:', error.message);
        return res.status(500).json({ error: 'Database query failed' });
      }
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    if (allRows.length === 0) {
      return res.status(200).json({ features: [], count: 0 });
    }

    // Convert to GeoJSON features
    const features = allRows.map((row) => ({
      type: 'Feature' as const,
      geometry: row.geometry, // Already a GeoJSON LineString
      properties: {
        zone: row.zone,
        street: `${row.street_direction} ${row.street_name} ${row.street_type || ''}`.trim(),
        addrRange: `${row.address_range_low}\u2013${row.address_range_high}`,
        oddEven: row.odd_even,
        source: row.source,
      },
    }));

    // Filter by map bounds if provided
    let filtered = features;
    if (boundsStr) {
      const [north, south, east, west] = boundsStr.split(',').map(Number);
      if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west)) {
        filtered = features.filter((f) => {
          const coords = f.geometry.coordinates;
          const lats = coords.map((c: number[]) => c[1]);
          const lngs = coords.map((c: number[]) => c[0]);
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);
          const minLng = Math.min(...lngs);
          const maxLng = Math.max(...lngs);
          return maxLat >= south && minLat <= north && maxLng >= west && minLng <= east;
        });
      }
    }

    // Cache for 10 minutes (data changes rarely — only when permit zones are updated)
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1200');

    return res.status(200).json({
      features: filtered,
      count: filtered.length,
      total: allRows.length,
    });
  } catch (err) {
    console.error('[permit-zone-lines] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
