import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

/**
 * GET /api/permit-zone-lines
 *
 * Returns GeoJSON line features for permit zone street segments.
 *
 * Strategy (v2):
 *   1. Cross-axis coordinate (lng for N/S streets, lat for E/W streets)
 *      comes from `street_geocache` — real Nominatim-geocoded coordinates.
 *   2. Along-axis coordinate uses Chicago's regular address grid:
 *      800 addr = 1 mile, baselines at Madison (lat) and State (lng).
 *
 * This replaces the broken v1 that used hardcoded street lookup tables
 * which placed streets in completely wrong locations.
 */

// Chicago Grid Constants
const MADISON_LAT = 41.8819; // Madison St = 0 N/S
const STATE_LNG = -87.6278;  // State St = 0 E/W
const LAT_PER_ADDR = 0.01449 / 800; // ~0.00001811° per addr
const LNG_PER_ADDR = 0.01898 / 800; // ~0.00002373° per addr

interface GeoRef {
  ref_lat: number;
  ref_lng: number;
  ref_addr_num: number;
  axis: string; // 'ns' | 'ew'
}

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

    // Build permit zone query
    let zoneQuery = supabaseAdmin
      .from('parking_permit_zones')
      .select('zone, street_direction, street_name, street_type, address_range_low, address_range_high, odd_even')
      .eq('status', 'ACTIVE');

    if (zoneFilter) {
      zoneQuery = zoneQuery.eq('zone', zoneFilter);
    }

    // Fetch permit zones (paginated — can be >1000) and geocache in parallel
    // Geocache is <1100 rows so single fetch is fine
    const geocachePromise = supabaseAdmin
      .from('street_geocache')
      .select('street_direction, street_name, street_type, ref_lat, ref_lng, ref_addr_num, axis');

    // Paginate permit zones
    const zones: any[] = [];
    let from = 0;
    const PAGE_SIZE = 1000;
    let firstError: any = null;
    while (true) {
      const { data, error: fetchErr } = await zoneQuery.range(from, from + PAGE_SIZE - 1);
      if (fetchErr) { firstError = fetchErr; break; }
      if (!data || data.length === 0) break;
      zones.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
      // Re-create query for next page (range modifies in place)
      zoneQuery = supabaseAdmin
        .from('parking_permit_zones')
        .select('zone, street_direction, street_name, street_type, address_range_low, address_range_high, odd_even')
        .eq('status', 'ACTIVE');
      if (zoneFilter) zoneQuery = zoneQuery.eq('zone', zoneFilter);
    }

    const geocacheResult = await geocachePromise;

    if (firstError) {
      console.error('[permit-zone-lines] DB error:', firstError.message);
      return res.status(500).json({ error: 'Database query failed' });
    }
    if (zones.length === 0) {
      return res.status(200).json({ features: [], count: 0 });
    }

    // Build geocache lookup map: "dir|name|type" → GeoRef
    const geocache = new Map<string, GeoRef>();
    for (const g of (geocacheResult.data || [])) {
      const key = `${g.street_direction}|${g.street_name}|${g.street_type || ''}`;
      geocache.set(key, {
        ref_lat: g.ref_lat,
        ref_lng: g.ref_lng,
        ref_addr_num: g.ref_addr_num,
        axis: g.axis,
      });
    }

    // Convert each permit zone to a GeoJSON LineString feature
    const features: any[] = [];
    let unresolved = 0;

    for (const z of zones) {
      const key = `${z.street_direction}|${z.street_name}|${z.street_type || ''}`;
      const geo = geocache.get(key);
      if (!geo) {
        unresolved++;
        continue;
      }

      const dir = z.street_direction;
      const addrLow = z.address_range_low;
      const addrHigh = z.address_range_high;
      if (!addrLow || !addrHigh) continue;

      let startLat: number, startLng: number, endLat: number, endLng: number;

      if (geo.axis === 'ns') {
        // N-S street: longitude from geocache, latitude from grid math
        const lng = geo.ref_lng;
        const sign = dir === 'N' ? 1 : -1;
        startLat = MADISON_LAT + sign * addrLow * LAT_PER_ADDR;
        endLat = MADISON_LAT + sign * addrHigh * LAT_PER_ADDR;
        startLng = lng;
        endLng = lng;
      } else {
        // E-W street: latitude from geocache, longitude from grid math
        const lat = geo.ref_lat;
        const sign = dir === 'E' ? 1 : dir === 'W' ? -1 : 0;
        startLng = STATE_LNG + sign * addrLow * LNG_PER_ADDR;
        endLng = STATE_LNG + sign * addrHigh * LNG_PER_ADDR;
        startLat = lat;
        endLat = lat;
      }

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [[startLng, startLat], [endLng, endLat]],
        },
        properties: {
          zone: z.zone,
          street: `${dir} ${z.street_name} ${z.street_type || ''}`.trim(),
          addrRange: `${addrLow}\u2013${addrHigh}`,
          oddEven: z.odd_even,
        },
      });
    }

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

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      features: filtered,
      count: filtered.length,
      total: zones.length,
      resolved: features.length,
      unresolved,
      geocached: geocache.size,
    });
  } catch (err) {
    console.error('[permit-zone-lines] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
