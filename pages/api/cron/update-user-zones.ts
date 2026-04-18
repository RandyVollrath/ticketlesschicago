import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { resolveAddressZone } from '../../../lib/address-zone-resolver';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Daily cron: ensure every user with an address has the correct ward + section.
 *
 * Two passes:
 * 1. For users with a saved address but NO coordinates, geocode via Google and
 *    run PostGIS. Covers settings.tsx and signup flows that upsert the text
 *    address without lat/lng — those rows bypass the auto_fill_user_profile_zone
 *    DB trigger (which only fires when lat/lng are present).
 * 2. For users with coords whose ward/section is stale or missing (zones
 *    redrawn, moved, etc.), re-run point-in-polygon and update.
 *
 * Schedule: daily at 8am UTC / 3am CDT (vercel.json).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Pass 1: users with an address but no coordinates — geocode + PostGIS.
    const { data: missingCoords } = await supabase
      .from('user_profiles')
      .select('user_id, email, street_address, home_address_full')
      .or('home_address_lat.is.null,home_address_lng.is.null')
      .or('street_address.not.is.null,home_address_full.not.is.null');

    let geocoded = 0;
    const geocodeChanges: string[] = [];
    for (const u of missingCoords || []) {
      const addr = (u as any).street_address || (u as any).home_address_full;
      if (!addr) continue;
      const resolved = await resolveAddressZone(addr);
      if (!resolved) continue;
      await supabase.from('user_profiles').update({
        home_address_lat: resolved.lat,
        home_address_lng: resolved.lng,
        // The DB trigger will fill ward/section once lat/lng land, but set
        // them here too in case the trigger isn't installed yet.
        home_address_ward: resolved.ward,
        home_address_section: resolved.section,
      }).eq('user_id', (u as any).user_id);
      geocoded++;
      geocodeChanges.push(`${(u as any).email}: geocoded "${addr}" → W${resolved.ward} S${resolved.section}`);
    }

    // Pass 2: users with coords — point-in-polygon refresh.
    const { data: users } = await supabase
      .from('user_profiles')
      .select('user_id, email, home_address_lat, home_address_lng, home_address_ward, home_address_section')
      .not('home_address_lat', 'is', null)
      .not('home_address_lng', 'is', null);

    if (!users?.length) {
      return res.status(200).json({ message: 'No users with coordinates', updated: 0, geocoded });
    }

    // Load zone polygons from zone_geometry_edits + schedule
    const { data: edits } = await supabase
      .from('zone_geometry_edits')
      .select('ward_section, geometry');

    const editMap = new Map<string, any>();
    for (const e of (edits || [])) {
      if (e.geometry) editMap.set(e.ward_section, e.geometry);
    }

    // Get all zone geometries from schedule (deduplicated)
    let allZones: any[] = [];
    let page = 0;
    while (true) {
      const { data } = await supabase
        .from('street_cleaning_schedule')
        .select('ward_section, ward, section, geom')
        .range(page * 1000, (page + 1) * 1000 - 1);
      if (!data?.length) break;
      allZones.push(...data);
      page++;
    }

    // Dedupe and prefer edits
    const zoneGeom = new Map<string, { ward: string; section: string; geom: any }>();
    for (const z of allZones) {
      if (!zoneGeom.has(z.ward_section) && z.geom) {
        zoneGeom.set(z.ward_section, {
          ward: z.ward,
          section: z.section,
          geom: editMap.get(z.ward_section) || z.geom,
        });
      }
    }

    // Simple point-in-polygon (ray casting)
    function pointInPolygon(lng: number, lat: number, ring: number[][]): boolean {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      return inside;
    }

    function pointInGeometry(lng: number, lat: number, geom: any): boolean {
      if (geom.type === 'MultiPolygon') {
        for (const poly of geom.coordinates) {
          if (pointInPolygon(lng, lat, poly[0])) return true;
        }
      } else if (geom.type === 'Polygon') {
        return pointInPolygon(lng, lat, geom.coordinates[0]);
      }
      return false;
    }

    let updated = 0;
    const changes: string[] = [];

    for (const user of users) {
      const lng = parseFloat(user.home_address_lng);
      const lat = parseFloat(user.home_address_lat);
      if (isNaN(lng) || isNaN(lat)) continue;

      let foundWard: string | null = null;
      let foundSection: string | null = null;

      for (const [ws, zone] of zoneGeom) {
        if (pointInGeometry(lng, lat, zone.geom)) {
          foundWard = zone.ward;
          foundSection = zone.section;
          break;
        }
      }

      if (foundWard && foundSection &&
          (foundWard !== user.home_address_ward || foundSection !== user.home_address_section)) {
        await supabase
          .from('user_profiles')
          .update({ home_address_ward: foundWard, home_address_section: foundSection })
          .eq('user_id', user.user_id);
        updated++;
        changes.push(`${user.email}: W${user.home_address_ward} S${user.home_address_section} → W${foundWard} S${foundSection}`);
      }
    }

    console.log(`Zone update: checked ${users.length} users, updated ${updated}`);
    if (changes.length) console.log('Changes:', changes.join('; '));

    res.status(200).json({
      checked: users.length,
      updated,
      geocoded,
      changes,
      geocodeChanges,
    });
  } catch (err: any) {
    console.error('Zone update error:', err);
    res.status(500).json({ error: err.message });
  }
}
