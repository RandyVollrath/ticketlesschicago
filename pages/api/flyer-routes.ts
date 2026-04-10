import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const TA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const TA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = TA_URL && TA_KEY ? createClient(TA_URL, TA_KEY) : null;

// ============================================================================
// FOIA DATA: Top ticket blocks, streets, and ward stats (2023-2024)
// Source: 35.7M ticket rows, violation_code 0964040B (STREET CLEANING)
// ============================================================================

// Top blocks by ticket density (block = 100-block, e.g. "1000 W Granville Ave")
// These are the exact stretches where ticket writers hammer hardest
const TOP_BLOCKS: HotBlock[] = [
  { block: '1000 W Granville Ave', tickets: 696, daysTicketed: 129, lat: 41.9940, lng: -87.6580, neighborhood: 'Edgewater', ward: '48' },
  { block: '4200 N Broadway', tickets: 555, daysTicketed: 65, lat: 41.9595, lng: -87.6483, neighborhood: 'Uptown', ward: '46' },
  { block: '2100 W 18th St', tickets: 516, daysTicketed: 198, lat: 41.8579, lng: -87.6780, neighborhood: 'Pilsen', ward: '25' },
  { block: '1800 W 18th St', tickets: 482, daysTicketed: 181, lat: 41.8579, lng: -87.6710, neighborhood: 'Pilsen', ward: '25' },
  { block: '2200 W 18th St', tickets: 464, daysTicketed: 183, lat: 41.8579, lng: -87.6805, neighborhood: 'Pilsen', ward: '25' },
  { block: '2600 N Kimball Ave', tickets: 440, daysTicketed: 68, lat: 41.9296, lng: -87.7130, neighborhood: 'Avondale', ward: '35' },
  { block: '1700 E 67th St', tickets: 435, daysTicketed: 65, lat: 41.7736, lng: -87.5850, neighborhood: 'Woodlawn / South Shore', ward: '5' },
  { block: '800 W Lawrence Ave', tickets: 434, daysTicketed: 49, lat: 41.9690, lng: -87.6500, neighborhood: 'Uptown', ward: '46' },
  { block: '2000 W Devon Ave', tickets: 424, daysTicketed: 128, lat: 41.9979, lng: -87.6790, neighborhood: 'West Rogers Park', ward: '50' },
  { block: '1800 W Cermak Rd', tickets: 416, daysTicketed: 191, lat: 41.8522, lng: -87.6680, neighborhood: 'Pilsen', ward: '25' },
  { block: '2100 W Devon Ave', tickets: 383, daysTicketed: 126, lat: 41.9979, lng: -87.6803, neighborhood: 'West Rogers Park', ward: '50' },
  { block: '1100 W Granville Ave', tickets: 380, daysTicketed: 112, lat: 41.9940, lng: -87.6600, neighborhood: 'Edgewater', ward: '48' },
  { block: '4000 N Broadway', tickets: 373, daysTicketed: 54, lat: 41.9560, lng: -87.6483, neighborhood: 'Uptown', ward: '46' },
  { block: '0 E Elm St', tickets: 365, daysTicketed: 85, lat: 41.9020, lng: -87.6280, neighborhood: 'Gold Coast', ward: '2' },
  { block: '0 E Walton St', tickets: 361, daysTicketed: 43, lat: 41.9000, lng: -87.6280, neighborhood: 'Gold Coast', ward: '42' },
  { block: '1000 W 18th St', tickets: 354, daysTicketed: 156, lat: 41.8579, lng: -87.6550, neighborhood: 'Pilsen', ward: '25' },
  { block: '1100 W 18th St', tickets: 351, daysTicketed: 178, lat: 41.8579, lng: -87.6575, neighborhood: 'Pilsen', ward: '25' },
  { block: '900 W 18th St', tickets: 346, daysTicketed: 151, lat: 41.8579, lng: -87.6525, neighborhood: 'Pilsen', ward: '25' },
  { block: '2000 W 18th St', tickets: 330, daysTicketed: 162, lat: 41.8579, lng: -87.6755, neighborhood: 'Pilsen', ward: '25' },
  { block: '4500 N Ashland Ave', tickets: 329, daysTicketed: 78, lat: 41.9630, lng: -87.6691, neighborhood: 'Uptown', ward: '46' },
  { block: '1900 W Cermak Rd', tickets: 319, daysTicketed: 170, lat: 41.8522, lng: -87.6700, neighborhood: 'Pilsen', ward: '25' },
  { block: '7000 N Glenwood Ave', tickets: 318, daysTicketed: 29, lat: 42.0090, lng: -87.6603, neighborhood: 'Rogers Park', ward: '49' },
  { block: '4400 N Ashland Ave', tickets: 315, daysTicketed: 82, lat: 41.9620, lng: -87.6691, neighborhood: 'Uptown', ward: '46' },
  { block: '6900 N Ravenswood Ave', tickets: 314, daysTicketed: 49, lat: 42.0080, lng: -87.6745, neighborhood: 'Rogers Park', ward: '49' },
  { block: '3300 S Morgan St', tickets: 313, daysTicketed: 85, lat: 41.8340, lng: -87.6512, neighborhood: 'Bridgeport', ward: '11' },
  { block: '700 S Loomis St', tickets: 309, daysTicketed: 105, lat: 41.8725, lng: -87.6620, neighborhood: 'University Village', ward: '25' },
  { block: '2300 W 18th St', tickets: 307, daysTicketed: 150, lat: 41.8579, lng: -87.6830, neighborhood: 'Pilsen', ward: '25' },
  { block: '1700 W Cermak Rd', tickets: 307, daysTicketed: 133, lat: 41.8522, lng: -87.6680, neighborhood: 'Pilsen', ward: '25' },
  { block: '3500 W Montrose Ave', tickets: 304, daysTicketed: 66, lat: 41.9614, lng: -87.7170, neighborhood: 'Albany Park', ward: '33' },
  { block: '2300 E 67th St', tickets: 299, daysTicketed: 54, lat: 41.7736, lng: -87.5760, neighborhood: 'South Shore', ward: '5' },
  { block: '3600 W Montrose Ave', tickets: 296, daysTicketed: 67, lat: 41.9614, lng: -87.7195, neighborhood: 'Albany Park', ward: '33' },
  { block: '1400 N Ashland Ave', tickets: 295, daysTicketed: 57, lat: 41.9076, lng: -87.6691, neighborhood: 'Wicker Park', ward: '32' },
  { block: '2600 N Laramie Ave', tickets: 293, daysTicketed: 81, lat: 41.9296, lng: -87.7543, neighborhood: 'Belmont Cragin', ward: '31' },
  { block: '1300 W 18th St', tickets: 290, daysTicketed: 166, lat: 41.8579, lng: -87.6610, neighborhood: 'Pilsen', ward: '25' },
  { block: '200 E Ohio St', tickets: 289, daysTicketed: 43, lat: 41.8923, lng: -87.6220, neighborhood: 'Streeterville', ward: '42' },
  { block: '1300 W Wilson Ave', tickets: 282, daysTicketed: 31, lat: 41.9654, lng: -87.6610, neighborhood: 'Uptown', ward: '46' },
  { block: '0 E Cedar St', tickets: 282, daysTicketed: 88, lat: 41.9028, lng: -87.6280, neighborhood: 'Gold Coast', ward: '2' },
  { block: '4800 N Ashland Ave', tickets: 281, daysTicketed: 57, lat: 41.9685, lng: -87.6691, neighborhood: 'Uptown', ward: '46' },
  { block: '4100 N Ashland Ave', tickets: 274, daysTicketed: 73, lat: 41.9555, lng: -87.6691, neighborhood: 'Uptown', ward: '46' },
  { block: '2300 S Marshall Blvd', tickets: 268, daysTicketed: 93, lat: 41.8497, lng: -87.6983, neighborhood: 'Little Village', ward: '24' },
];

// Top blocks for SEIZURE-level street cleaning tickets (boot/tow eligible)
// notice_level='SEIZ' = the city has issued a seizure notice = car will be booted/towed
// These drivers are actively losing their cars. They will pay anything to make it stop.
const TOW_BLOCKS: HotBlock[] = [
  { block: '1700 E 67th St', tickets: 335, daysTicketed: 65, lat: 41.7736, lng: -87.5850, neighborhood: 'Woodlawn / South Shore', ward: '5' },
  { block: '1000 W Granville Ave', tickets: 288, daysTicketed: 129, lat: 41.9940, lng: -87.6580, neighborhood: 'Edgewater', ward: '48' },
  { block: '2300 E 67th St', tickets: 187, daysTicketed: 54, lat: 41.7736, lng: -87.5760, neighborhood: 'South Shore', ward: '5' },
  { block: '2100 W 18th St', tickets: 184, daysTicketed: 198, lat: 41.8579, lng: -87.6780, neighborhood: 'Pilsen', ward: '25' },
  { block: '2000 W Devon Ave', tickets: 168, daysTicketed: 128, lat: 41.9979, lng: -87.6790, neighborhood: 'West Rogers Park', ward: '50' },
  { block: '2900 S State St', tickets: 163, daysTicketed: 0, lat: 41.8420, lng: -87.6270, neighborhood: 'Bronzeville', ward: '3' },
  { block: '400 E 35th St', tickets: 157, daysTicketed: 0, lat: 41.8313, lng: -87.6190, neighborhood: 'Bronzeville / IIT', ward: '3' },
  { block: '800 W 31st St', tickets: 151, daysTicketed: 61, lat: 41.8385, lng: -87.6500, neighborhood: 'Bridgeport', ward: '11' },
  { block: '2200 W 18th St', tickets: 151, daysTicketed: 183, lat: 41.8579, lng: -87.6805, neighborhood: 'Pilsen', ward: '25' },
  { block: '1600 E 67th St', tickets: 151, daysTicketed: 0, lat: 41.7736, lng: -87.5860, neighborhood: 'Woodlawn', ward: '5' },
  { block: '2300 E 71st St', tickets: 147, daysTicketed: 36, lat: 41.7647, lng: -87.5760, neighborhood: 'South Shore', ward: '5' },
  { block: '4200 N Broadway', tickets: 145, daysTicketed: 65, lat: 41.9595, lng: -87.6483, neighborhood: 'Uptown', ward: '46' },
  { block: '2200 E 67th St', tickets: 140, daysTicketed: 0, lat: 41.7736, lng: -87.5775, neighborhood: 'South Shore', ward: '5' },
  { block: '2600 N Laramie Ave', tickets: 138, daysTicketed: 81, lat: 41.9296, lng: -87.7543, neighborhood: 'Belmont Cragin', ward: '31' },
  { block: '2100 W Devon Ave', tickets: 136, daysTicketed: 126, lat: 41.9979, lng: -87.6803, neighborhood: 'West Rogers Park', ward: '50' },
  { block: '1100 W Granville Ave', tickets: 134, daysTicketed: 112, lat: 41.9940, lng: -87.6600, neighborhood: 'Edgewater', ward: '48' },
  { block: '1800 W Cermak Rd', tickets: 133, daysTicketed: 191, lat: 41.8522, lng: -87.6680, neighborhood: 'Pilsen', ward: '25' },
  { block: '3600 S Indiana Ave', tickets: 131, daysTicketed: 0, lat: 41.8275, lng: -87.6217, neighborhood: 'Bronzeville', ward: '3' },
  { block: '800 W Lawrence Ave', tickets: 129, daysTicketed: 49, lat: 41.9690, lng: -87.6500, neighborhood: 'Uptown', ward: '46' },
  { block: '4200 S Michigan Ave', tickets: 129, daysTicketed: 27, lat: 41.8175, lng: -87.6225, neighborhood: 'Bronzeville', ward: '3' },
  { block: '4400 N Ashland Ave', tickets: 127, daysTicketed: 82, lat: 41.9620, lng: -87.6691, neighborhood: 'Uptown', ward: '46' },
  { block: '2300 W 18th St', tickets: 127, daysTicketed: 150, lat: 41.8579, lng: -87.6830, neighborhood: 'Pilsen', ward: '25' },
  { block: '1900 W Cermak Rd', tickets: 118, daysTicketed: 170, lat: 41.8522, lng: -87.6700, neighborhood: 'Pilsen', ward: '25' },
  { block: '2000 W 18th St', tickets: 116, daysTicketed: 162, lat: 41.8579, lng: -87.6755, neighborhood: 'Pilsen', ward: '25' },
  { block: '3900 S Indiana Ave', tickets: 114, daysTicketed: 0, lat: 41.8245, lng: -87.6217, neighborhood: 'Bronzeville', ward: '3' },
  { block: '1000 W 18th St', tickets: 114, daysTicketed: 156, lat: 41.8579, lng: -87.6550, neighborhood: 'Pilsen', ward: '25' },
  { block: '8700 S Burley Ave', tickets: 113, daysTicketed: 0, lat: 41.7370, lng: -87.5510, neighborhood: 'South Chicago', ward: '10' },
  { block: '2300 S Marshall Blvd', tickets: 113, daysTicketed: 93, lat: 41.8497, lng: -87.6983, neighborhood: 'Little Village', ward: '24' },
  { block: '1700 W Cermak Rd', tickets: 113, daysTicketed: 133, lat: 41.8522, lng: -87.6680, neighborhood: 'Pilsen', ward: '25' },
  { block: '1800 W 18th St', tickets: 111, daysTicketed: 181, lat: 41.8579, lng: -87.6710, neighborhood: 'Pilsen', ward: '25' },
];

// Neighborhood priority rankings — aggregate ticket data tells us where to spend time
// Score = total tickets per block in neighborhood (higher = more people getting ticketed = more potential customers)
const NEIGHBORHOOD_RANKINGS: NeighborhoodRank[] = [
  { name: 'Pilsen (Ward 25)', totalTickets: 4416, blocks: 10, avgPerBlock: 442, topStreets: ['W 18th St', 'W Cermak Rd'], strategy: 'Massive ticket zone. 18th St alone has 10 blocks in the top 100. Every cleaning day is a goldmine. Focus on 18th St from Loomis to Western, and Cermak from Ashland to Western.', zipcode: '60608' },
  { name: 'Uptown / Buena Park (Ward 46)', totalTickets: 3251, blocks: 8, avgPerBlock: 406, topStreets: ['N Broadway', 'N Ashland Ave', 'W Lawrence Ave', 'W Wilson Ave'], strategy: 'Dense apartment parking along Broadway and Ashland. Cars packed bumper-to-bumper. Hit the Ashland corridor from Montrose to Bryn Mawr.', zipcode: '60640' },
  { name: 'Edgewater (Ward 48)', totalTickets: 1076, blocks: 2, avgPerBlock: 538, topStreets: ['W Granville Ave'], strategy: 'Granville Ave is a monster — 696 tickets on one block alone. The 1000-1100 blocks of Granville are the #1 and #12 worst blocks citywide.', zipcode: '60660' },
  { name: 'Gold Coast (Ward 2/42)', totalTickets: 1008, blocks: 3, avgPerBlock: 336, topStreets: ['E Elm St', 'E Walton St', 'E Cedar St'], strategy: 'Wealthy area with expensive cars. Drivers here can afford the app. High-value flyer targets. Focus on the 0 block of Elm, Walton, and Cedar.', zipcode: '60610' },
  { name: 'West Rogers Park (Ward 50)', totalTickets: 807, blocks: 2, avgPerBlock: 404, topStreets: ['W Devon Ave'], strategy: 'Devon Ave corridor from Western to California. Dense commercial street parking. Two blocks both in top 15 citywide.', zipcode: '60659' },
  { name: 'Albany Park (Ward 33)', totalTickets: 600, blocks: 2, avgPerBlock: 300, topStreets: ['W Montrose Ave', 'W Lawrence Ave'], strategy: 'Montrose Ave from Kedzie to Pulaski. Heavy residential parking both sides. Two blocks in the top 50.', zipcode: '60625' },
  { name: 'Rogers Park (Ward 49)', totalTickets: 632, blocks: 2, avgPerBlock: 316, topStreets: ['N Glenwood Ave', 'N Ravenswood Ave'], strategy: 'Glenwood and Ravenswood around Howard. Dense rental area — residents forget cleaning day constantly.', zipcode: '60626' },
  { name: 'Avondale (Ward 35)', totalTickets: 440, blocks: 1, avgPerBlock: 440, topStreets: ['N Kimball Ave'], strategy: 'Kimball Ave from Diversey to Belmont. One concentrated block with 440 tickets. Quick hit.', zipcode: '60618' },
  { name: 'South Shore / Woodlawn (Ward 5)', totalTickets: 734, blocks: 2, avgPerBlock: 367, topStreets: ['E 67th St'], strategy: '67th St between Stony Island and the lake. Consistent ticketing zone.', zipcode: '60649' },
  { name: 'Bridgeport (Ward 11)', totalTickets: 313, blocks: 1, avgPerBlock: 313, topStreets: ['S Morgan St'], strategy: 'Morgan St south of 33rd. Quick single-block hit near Sox park area.', zipcode: '60609' },
  { name: 'Belmont Cragin (Ward 31)', totalTickets: 293, blocks: 1, avgPerBlock: 293, topStreets: ['N Laramie Ave'], strategy: 'Laramie at Diversey. Dense residential parking.', zipcode: '60639' },
  { name: 'Little Village (Ward 24)', totalTickets: 268, blocks: 1, avgPerBlock: 268, topStreets: ['S Marshall Blvd'], strategy: 'Marshall Blvd near Cermak. Residential area with heavy street parking.', zipcode: '60623' },
  { name: 'Streeterville (Ward 42)', totalTickets: 289, blocks: 1, avgPerBlock: 289, topStreets: ['E Ohio St'], strategy: 'Ohio St near Michigan Ave. Tourists and commuters — high visibility.', zipcode: '60611' },
  { name: 'Wicker Park (Ward 32)', totalTickets: 295, blocks: 1, avgPerBlock: 295, topStreets: ['N Ashland Ave'], strategy: 'Ashland at North Ave. Hip neighborhood, app-savvy demographic.', zipcode: '60622' },
];

// Ward-level ticket counts (2024) — used to score zones by ward ticket intensity
const WARD_TICKET_COUNTS: Record<string, number> = {
  '1': 15967, '25': 12390, '26': 11921, '35': 10618, '28': 10441,
  '43': 10330, '15': 10243, '33': 9874, '44': 9843, '46': 10179,
  '31': 9490, '49': 9392, '3': 8963, '5': 8713, '24': 8642,
  '36': 8568, '32': 7970, '37': 7816, '47': 7794, '48': 7781,
  '50': 7671, '30': 7663, '27': 7400, '4': 7203, '40': 7135,
  '2': 7051, '29': 6990, '42': 6000, '11': 5500, '12': 5200,
};

interface HotBlock {
  block: string;
  tickets: number;
  daysTicketed: number;
  lat: number;
  lng: number;
  neighborhood: string;
  ward: string;
}

interface NeighborhoodRank {
  name: string;
  totalTickets: number;
  blocks: number;
  avgPerBlock: number;
  topStreets: string[];
  strategy: string;
  zipcode: string;
}

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

// Nearest-neighbor TSP approximation
function optimizeRoute<T extends { lat: number; lng: number }>(points: T[], startLat: number, startLng: number): T[] {
  if (points.length === 0) return [];
  const remaining = [...points];
  const route: T[] = [];
  let curLat = startLat, curLng = startLng;
  while (remaining.length > 0) {
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const dlat = remaining[i].lat - curLat;
      const dlng = (remaining[i].lng - curLng) * Math.cos(curLat * Math.PI / 180);
      const dist = dlat * dlat + dlng * dlng;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    const next = remaining.splice(bestIdx, 1)[0];
    route.push(next);
    curLat = next.lat;
    curLng = next.lng;
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

    // Chicago timezone dates
    const chicagoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const todayStr = chicagoNow.toISOString().split('T')[0];
    const yesterday = new Date(chicagoNow);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    const tomorrow = new Date(chicagoNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Fetch schedule for yesterday, today, and tomorrow
    const { data: scheduleData, error: dbError } = await supabase
      .from('street_cleaning_schedule')
      .select('ward, section, cleaning_date, north_street, south_street, east_street, west_street, north_block, south_block, east_block, west_block')
      .not('ward', 'is', null)
      .not('section', 'is', null)
      .in('cleaning_date', [yesterdayStr, todayStr, tomorrowStr]);

    if (dbError) {
      return res.status(500).json({ error: 'Failed to fetch schedule data' });
    }

    // Filter out Sundays
    const filteredSchedule = (scheduleData || []).filter(item => {
      const date = new Date(item.cleaning_date + 'T12:00:00Z');
      return date.getDay() !== 0;
    });

    const centroids = loadZoneCentroids();
    const centroidMap = new Map(centroids.map(c => [`${c.ward}-${c.section}`, c]));

    const yesterdayZones: any[] = [];
    const todayZones: any[] = [];
    const tomorrowZones: any[] = [];

    for (const item of filteredSchedule) {
      const key = `${item.ward}-${item.section}`;
      const centroid = centroidMap.get(key);
      if (!centroid) continue;

      const wardTickets = WARD_TICKET_COUNTS[item.ward] || 5000;
      // Priority score: higher ward ticket count = more people getting ticketed = better ROI
      const priorityScore = Math.round(wardTickets / 1000);

      const zone = {
        ward: item.ward,
        section: item.section,
        cleaningDate: item.cleaning_date,
        lat: centroid.lat,
        lng: centroid.lng,
        priorityScore,
        wardTickets2024: wardTickets,
        boundaries: {
          north: item.north_block || item.north_street || '',
          south: item.south_block || item.south_street || '',
          east: item.east_block || item.east_street || '',
          west: item.west_block || item.west_street || '',
        },
      };

      if (item.cleaning_date === yesterdayStr) yesterdayZones.push(zone);
      else if (item.cleaning_date === todayStr) todayZones.push(zone);
      else tomorrowZones.push(zone);
    }

    // Sort by priority score (highest first) then optimize route within priority tiers
    const startLat = parseFloat(req.query.startLat as string) || 41.8781;
    const startLng = parseFloat(req.query.startLng as string) || -87.6298;

    const sortAndOptimize = (zones: any[]) => {
      // Sort by priority desc first, then optimize within each group
      zones.sort((a: any, b: any) => b.priorityScore - a.priorityScore);
      return optimizeRoute(zones, startLat, startLng);
    };

    // Day of week intelligence
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const tomorrowDay = dayNames[tomorrow.getDay()];
    const isPeakDay = [2, 3, 4].includes(tomorrow.getDay()); // Tue/Wed/Thu

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      success: true,
      chicagoDate: todayStr,
      chicagoDateYesterday: yesterdayStr,
      chicagoDateTomorrow: tomorrowStr,
      tomorrowDayOfWeek: tomorrowDay,
      isPeakTicketDay: isPeakDay,
      // "Just cleaned" = yesterday + today. People there just got ticketed!
      justCleanedZones: sortAndOptimize([...yesterdayZones, ...todayZones]),
      justCleanedCount: yesterdayZones.length + todayZones.length,
      // Tomorrow = flyer TONIGHT for max impact
      tomorrowZones: sortAndOptimize(tomorrowZones),
      tomorrowCount: tomorrowZones.length,
      // Block-level hotspots with FOIA data
      hotBlocks: TOP_BLOCKS,
      // Tow/seizure-eligible blocks (cars actively being booted/towed)
      towBlocks: TOW_BLOCKS,
      // Neighborhood intelligence
      neighborhoods: NEIGHBORHOOD_RANKINGS,
      startingPoint: { lat: startLat, lng: startLng },
    });
  } catch (error: any) {
    console.error('Flyer routes API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
