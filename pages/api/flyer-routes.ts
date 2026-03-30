import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const TA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = TA_URL && TA_KEY ? createClient(TA_URL, TA_KEY) : null;

// Top street cleaning ticket hotspot addresses (from FOIA data, 2023-2024)
// These are the addresses where the most street cleaning tickets are issued citywide
const TOP_HOTSPOTS = [
  { address: '303 E Huron St', tickets2023: 78, ticketsAllTime: 90, lat: 41.8948, lng: -87.6189, neighborhood: 'Gold Coast / Streeterville' },
  { address: '100 E Walton St', tickets2023: 72, ticketsAllTime: 286, lat: 41.9000, lng: -87.6275, neighborhood: 'Gold Coast' },
  { address: '7 E Chestnut St', tickets2023: 61, ticketsAllTime: 115, lat: 41.8983, lng: -87.6282, neighborhood: 'Gold Coast' },
  { address: '148 E Lake Shore Dr', tickets2023: 58, ticketsAllTime: 64, lat: 41.8857, lng: -87.6168, neighborhood: 'Streeterville' },
  { address: '435 E 35th St', tickets2023: 52, ticketsAllTime: 110, lat: 41.8313, lng: -87.6178, neighborhood: 'Bronzeville / IIT' },
  { address: '2130 W Cermak Rd', tickets2023: 51, ticketsAllTime: 72, lat: 41.8522, lng: -87.6793, neighborhood: 'Pilsen' },
  { address: '67 E Chestnut St', tickets2023: 50, ticketsAllTime: 71, lat: 41.8983, lng: -87.6253, neighborhood: 'Gold Coast' },
  { address: '1011 W 18th St', tickets2023: 45, ticketsAllTime: 88, lat: 41.8579, lng: -87.6551, neighborhood: 'Pilsen' },
  { address: '2107 S Western Ave', tickets2023: 44, ticketsAllTime: 63, lat: 41.8543, lng: -87.6860, neighborhood: 'Pilsen' },
  { address: '205 E Ohio St', tickets2023: 43, ticketsAllTime: 56, lat: 41.8923, lng: -87.6220, neighborhood: 'Streeterville' },
  { address: '449 E 35th St', tickets2023: 42, ticketsAllTime: 103, lat: 41.8313, lng: -87.6170, neighborhood: 'Bronzeville / IIT' },
  { address: '38 E Walton St', tickets2023: 41, ticketsAllTime: 60, lat: 41.9000, lng: -87.6290, neighborhood: 'Gold Coast' },
  { address: '1708 W Cermak Rd', tickets2023: 40, ticketsAllTime: 78, lat: 41.8522, lng: -87.6680, neighborhood: 'Pilsen' },
  { address: '3001 S Indiana Ave', tickets2023: 39, ticketsAllTime: 86, lat: 41.8388, lng: -87.6217, neighborhood: 'Bronzeville' },
  { address: '1055 W Bryn Mawr Ave', tickets2023: 38, ticketsAllTime: 92, lat: 41.9838, lng: -87.6580, neighborhood: 'Edgewater' },
  { address: '1134 W Granville Ave', tickets2023: 38, ticketsAllTime: 69, lat: 41.9940, lng: -87.6592, neighborhood: 'Edgewater' },
  { address: '2243 W 18th St', tickets2023: 38, ticketsAllTime: 69, lat: 41.8579, lng: -87.6822, neighborhood: 'Pilsen' },
  { address: '319 S Jefferson', tickets2023: 38, ticketsAllTime: 149, lat: 41.8773, lng: -87.6424, neighborhood: 'West Loop' },
  { address: '1704 W Cermak Rd', tickets2023: 37, ticketsAllTime: 80, lat: 41.8522, lng: -87.6678, neighborhood: 'Pilsen' },
  { address: '307 S Desplaines', tickets2023: 37, ticketsAllTime: 68, lat: 41.8773, lng: -87.6440, neighborhood: 'West Loop' },
  { address: '2355 E 67th St', tickets2023: 35, ticketsAllTime: 118, lat: 41.7736, lng: -87.5754, neighborhood: 'South Shore' },
  { address: '1905 W Taylor St', tickets2023: 34, ticketsAllTime: 79, lat: 41.8692, lng: -87.6740, neighborhood: 'Tri-Taylor / UIC' },
  { address: '237 S Desplaines', tickets2023: 34, ticketsAllTime: 111, lat: 41.8780, lng: -87.6440, neighborhood: 'West Loop' },
  { address: '328 S Jefferson', tickets2023: 34, ticketsAllTime: 105, lat: 41.8769, lng: -87.6424, neighborhood: 'West Loop' },
  { address: '6400 N Artesian Ave', tickets2023: 33, ticketsAllTime: 42, lat: 41.9980, lng: -87.6885, neighborhood: 'West Rogers Park' },
  { address: '2136 W Devon Ave', tickets2023: 32, ticketsAllTime: 71, lat: 41.9979, lng: -87.6803, neighborhood: 'West Rogers Park' },
  { address: '3643 W Montrose Ave', tickets2023: 32, ticketsAllTime: 54, lat: 41.9614, lng: -87.7188, neighborhood: 'Albany Park' },
  { address: '4452 N Ashland Ave', tickets2023: 32, ticketsAllTime: 49, lat: 41.9630, lng: -87.6691, neighborhood: 'Uptown' },
  { address: '1627 E 67th St', tickets2023: 31, ticketsAllTime: 107, lat: 41.7736, lng: -87.5850, neighborhood: 'Woodlawn' },
  { address: '2140 W Devon Ave', tickets2023: 31, ticketsAllTime: 31, lat: 41.9979, lng: -87.6805, neighborhood: 'West Rogers Park' },
];

interface ZoneCentroid {
  ward: string;
  section: string;
  lat: number;
  lng: number;
}

let cachedCentroids: ZoneCentroid[] | null = null;

function loadZoneCentroids(): ZoneCentroid[] {
  if (cachedCentroids) return cachedCentroids;
  const filePath = path.join(process.cwd(), 'public', 'data', 'street-cleaning-zones-2026.geojson');
  const raw = fs.readFileSync(filePath, 'utf-8');
  const geojson = JSON.parse(raw);
  cachedCentroids = geojson.features.map((feat: any) => {
    const coords = feat.geometry.type === 'MultiPolygon'
      ? feat.geometry.coordinates[0][0]
      : feat.geometry.coordinates[0];
    const lats = coords.map((c: number[]) => c[1]);
    const lngs = coords.map((c: number[]) => c[0]);
    return {
      ward: feat.properties.ward,
      section: feat.properties.section,
      lat: lats.reduce((a: number, b: number) => a + b, 0) / lats.length,
      lng: lngs.reduce((a: number, b: number) => a + b, 0) / lngs.length,
    };
  });
  return cachedCentroids!;
}

// Nearest-neighbor TSP approximation for driving route optimization
function optimizeRoute(points: { lat: number; lng: number; label: string }[], startLat: number, startLng: number) {
  if (points.length === 0) return [];
  const remaining = [...points];
  const route: typeof points = [];
  let currentLat = startLat;
  let currentLng = startLng;

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dlat = remaining[i].lat - currentLat;
      const dlng = remaining[i].lng - currentLng;
      // Approximate distance weighting lng by cos(lat)
      const dist = dlat * dlat + (dlng * Math.cos(currentLat * Math.PI / 180)) ** 2;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    route.push(next);
    currentLat = next.lat;
    currentLng = next.lng;
  }
  return route;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!supabase) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    // Get Chicago today and tomorrow dates
    const chicagoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const todayStr = chicagoNow.toISOString().split('T')[0];
    const tomorrow = new Date(chicagoNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Fetch schedule for today and tomorrow
    const { data: scheduleData, error: dbError } = await supabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date, north_street, south_street, east_street, west_street, north_block, south_block, east_block, west_block')
      .not('ward', 'is', null)
      .not('section', 'is', null)
      .in('cleaning_date', [todayStr, tomorrowStr]);

    if (dbError) {
      return res.status(500).json({ error: 'Failed to fetch schedule data' });
    }

    // Filter out Sundays
    const filteredSchedule = (scheduleData || []).filter(item => {
      const date = new Date(item.cleaning_date + 'T12:00:00Z');
      return date.getDay() !== 0;
    });

    // Load centroids and merge with schedule
    const centroids = loadZoneCentroids();
    const centroidMap = new Map(centroids.map(c => [`${c.ward}-${c.section}`, c]));

    const todayZones: any[] = [];
    const tomorrowZones: any[] = [];

    for (const item of filteredSchedule) {
      const key = `${item.ward}-${item.section}`;
      const centroid = centroidMap.get(key);
      if (!centroid) continue;

      const zone = {
        ward: item.ward,
        section: item.section,
        cleaningDate: item.cleaning_date,
        lat: centroid.lat,
        lng: centroid.lng,
        boundaries: {
          north: item.north_block || item.north_street || '',
          south: item.south_block || item.south_street || '',
          east: item.east_block || item.east_street || '',
          west: item.west_block || item.west_street || '',
        },
      };

      if (item.cleaning_date === todayStr) todayZones.push(zone);
      else tomorrowZones.push(zone);
    }

    // Parse optional starting location from query params
    const startLat = parseFloat(req.query.startLat as string) || 41.8781; // default: downtown Chicago
    const startLng = parseFloat(req.query.startLng as string) || -87.6298;

    // Optimize routes
    const todayRoute = optimizeRoute(
      todayZones.map(z => ({ lat: z.lat, lng: z.lng, label: `Ward ${z.ward} Sec ${z.section}` })),
      startLat, startLng
    );
    const tomorrowRoute = optimizeRoute(
      tomorrowZones.map(z => ({ lat: z.lat, lng: z.lng, label: `Ward ${z.ward} Sec ${z.section}` })),
      startLat, startLng
    );

    // Map route order back to zones
    const todayOrdered = todayRoute.map(r => {
      return todayZones.find(z => z.lat === r.lat && z.lng === r.lng);
    }).filter(Boolean);
    const tomorrowOrdered = tomorrowRoute.map(r => {
      return tomorrowZones.find(z => z.lat === r.lat && z.lng === r.lng);
    }).filter(Boolean);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      success: true,
      chicagoDate: todayStr,
      chicagoDateTomorrow: tomorrowStr,
      todayZones: todayOrdered,
      tomorrowZones: tomorrowOrdered,
      todayCount: todayOrdered.length,
      tomorrowCount: tomorrowOrdered.length,
      hotspots: TOP_HOTSPOTS,
      startingPoint: { lat: startLat, lng: startLng },
    });
  } catch (error: any) {
    console.error('Flyer routes API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
