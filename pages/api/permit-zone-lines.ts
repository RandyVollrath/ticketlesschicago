import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

/**
 * GET /api/permit-zone-lines
 *
 * Returns GeoJSON line features for permit zone street segments.
 *
 * Chicago's address grid is exceptionally regular:
 *   - 800 addresses = 1 mile (8 addresses per block of 100)
 *   - N/S baseline: Madison St (0 N/S) ≈ 41.8819°N
 *   - E/W baseline: State St (0 E/W) ≈ -87.6278°W
 *   - 1 mile N/S ≈ 0.01449° latitude
 *   - 1 mile E/W ≈ 0.01898° longitude (at Chicago's latitude)
 *
 * Each permit zone record has: direction, street_name, street_type,
 * address_range_low, address_range_high.  We convert the address range
 * to a lat/lng line segment using the grid math.
 *
 * Query params:
 *   bounds — "north,south,east,west" to filter visible area
 *   zone   — optional zone number to highlight
 */

// ---------------------------------------------------------------------------
// Chicago Grid Constants
// ---------------------------------------------------------------------------

// Baselines (lat/lng of address 0)
const MADISON_LAT = 41.8819; // Madison St = 0 N/S
const STATE_LNG = -87.6278; // State St = 0 E/W

// Degrees per address number
// 800 addresses = 1 mile; 1 mile lat ≈ 0.01449°, 1 mile lng ≈ 0.01898°
const LAT_PER_ADDR = 0.01449 / 800; // ~0.00001811° per address
const LNG_PER_ADDR = 0.01898 / 800; // ~0.00002373° per address

// Street types that typically run N-S vs E-W in Chicago
// N-S streets: have N/S direction prefixes, numbered addresses go N or S
// E-W streets: have E/W direction prefixes, numbered addresses go E or W
//
// The direction prefix tells us which axis the ADDRESS counts along:
//   "N" or "S" → address counts along N-S axis → street runs E-W
//   "E" or "W" → address counts along E-W axis → street runs N-S
//
// Wait — that's backwards. In Chicago:
//   "1200 N Clark St" means Clark St is 1200 addresses NORTH of Madison.
//   Clark St runs N-S, and 1200 is how far north you are on it.
//   So N/S direction → the street runs N-S, address increases N or S.
//   E/W direction → the street runs E-W, address increases E or W.

function addressToCoords(
  addrNum: number,
  direction: string,
): { lat: number; lng: number } {
  switch (direction) {
    case 'N':
      return { lat: MADISON_LAT + addrNum * LAT_PER_ADDR, lng: STATE_LNG };
    case 'S':
      return { lat: MADISON_LAT - addrNum * LAT_PER_ADDR, lng: STATE_LNG };
    case 'E':
      return { lat: MADISON_LAT, lng: STATE_LNG + addrNum * LNG_PER_ADDR };
    case 'W':
      return { lat: MADISON_LAT, lng: STATE_LNG - addrNum * LNG_PER_ADDR };
    default:
      return { lat: MADISON_LAT, lng: STATE_LNG };
  }
}

/**
 * For N/S-prefixed addresses (street runs N-S), the address number gives
 * the latitude but we need the street's LONGITUDE.  We look up the cross
 * street's E-W address equivalent.  Since we don't have that, we use a
 * heuristic: major Chicago streets have well-known E-W addresses.
 *
 * Alternatively, we can use the Nominatim geocoder for the street name to
 * get the approximate longitude, then use the address range for latitude.
 *
 * For the MVP, we'll use a lookup of known Chicago street longitudes/latitudes
 * and fall back to Nominatim for unknowns.
 */

// Well-known Chicago N-S streets (direction N or S) — need their longitude
// These are approximate E-W address numbers (from State St = 0)
const NS_STREET_EW_ADDR: Record<string, number> = {
  STATE: 0,
  DEARBORN: 50,
  CLARK: 100,
  LASALLE: 150,
  WELLS: 200,
  FRANKLIN: 300,
  WACKER: 350,
  CANAL: 500,
  CLINTON: 550,
  JEFFERSON: 600,
  DESPLAINES: 700,
  HALSTED: 800,
  GREEN: 900,
  PEORIA: 900,
  MORGAN: 1000,
  SANGAMON: 1050,
  RACINE: 1100,
  THROOP: 1100,
  LOOMIS: 1400,
  LAFLIN: 1500,
  ASHLAND: 1600,
  PAULINA: 1700,
  MARSHFIELD: 1700,
  HERMITAGE: 1700,
  WOOD: 1800,
  LINCOLN: 1800,
  HONORE: 1800,
  WOLCOTT: 1900,
  WINCHESTER: 1900,
  DAMEN: 2000,
  HOYNE: 2100,
  HAMILTON: 2100,
  LEAVITT: 2200,
  OAKLEY: 2300,
  CLAREMONT: 2300,
  WESTERN: 2400,
  ARTESIAN: 2500,
  CAMPBELL: 2500,
  ROCKWELL: 2600,
  WASHTENAW: 2700,
  TALMAN: 2700,
  FAIRFIELD: 2700,
  CALIFORNIA: 2800,
  MOZART: 2900,
  FRANCISCO: 2900,
  RICHMOND: 2900,
  SACRAMENTO: 3000,
  WHIPPLE: 3000,
  ALBANY: 3100,
  TROY: 3100,
  KEDZIE: 3200,
  SAWYER: 3300,
  SPAULDING: 3300,
  CHRISTIANA: 3400,
  ST_LOUIS: 3500,
  DRAKE: 3500,
  HOMAN: 3400,
  CENTRAL_PARK: 3600,
  MONTICELLO: 3600,
  LAWNDALE: 3700,
  RIDGEWAY: 3700,
  HAMLIN: 3800,
  AVERS: 3800,
  SPRINGFIELD: 3900,
  HARDING: 3900,
  PULASKI: 4000,
  KARLOV: 4100,
  KEELER: 4200,
  KILDARE: 4300,
  TRIPP: 4300,
  KOSTNER: 4400,
  KOLMAR: 4400,
  KILBOURN: 4500,
  KENNETH: 4500,
  KENTON: 4500,
  KNOX: 4500,
  CICERO: 4800,
  LAVERGNE: 5000,
  LOCKWOOD: 5100,
  LARAMIE: 5200,
  LONG: 5300,
  PINE: 5300,
  LOTUS: 5400,
  LEAMINGTON: 5400,
  LECLAIRE: 5500,
  LATROBE: 5500,
  MENARD: 5600,
  MASON: 5700,
  AUSTIN: 6000,
  CENTRAL: 5600,
  NARRAGANSETT: 6400,
  NEENAH: 6500,
  NEWLAND: 6500,
  NORDICA: 6600,
  NOTTINGHAM: 6700,
  NEWCASTLE: 6800,
  OAK_PARK: 6800,
  ORIOLE: 7200,
  OKETO: 7300,
  OSCEOLA: 7400,
  OLEANDER: 7500,
  OLCOTT: 7500,
  OVERHILL: 7600,
  HARLEM: 7200,
  CUMBERLAND: 8400,
  CANFIELD: 8400,
  MELVINA: 5700,
  MAJOR: 5700,
  MONITOR: 5800,
  // Some more common ones
  MICHIGAN: 100, // E of State
  WABASH: 50, // E of State
  INDIANA: 200,
  PRAIRIE: 300,
  CALUMET: 400,
  KING_DRIVE: 400,
  COTTAGE_GROVE: 800,
  DREXEL: 900,
  ELLIS: 1000,
  GREENWOOD: 1100,
  WOODLAWN: 1200,
  UNIVERSITY: 1200,
  KIMBARK: 1300,
  KENWOOD: 1300,
  DORCHESTER: 1400,
  BLACKSTONE: 1500,
  HARPER: 1600,
  LAKE_PARK: 1700,
  STONY_ISLAND: 1600,
  YATES: 2400,
  COLES: 2500,
  AVENUE_O: 2800,
  EWING: 2800,
  TORRENCE: 2600,
  BRANDON: 2600,
  CREGIER: 2100,
  CLYDE: 2100,
  JEFFERY: 2000,
  CHAPPEL: 1900,
  CRANDON: 1700,
  OGLESBY: 1700,
  PAXTON: 1700,
  MERRILL: 1700,
  EUCLID: 1700,
  EAST_END: 1700,
  BENNETT: 1800,
  MANISTEE: 1800,
  EXCHANGE: 1800,
  SAGINAW: 2600,
  MUSKEGON: 2700,
  HOUSTON: 2800,
  FARRELL: 3200,
};

// Well-known Chicago E-W streets (direction E or W) — need their latitude
// These are approximate N-S address numbers (from Madison St = 0)
const EW_STREET_NS_ADDR: Record<string, number> = {
  MADISON: 0,
  WASHINGTON: 100,
  RANDOLPH: 150,
  LAKE: 200,
  FULTON: 300,
  KINZIE: 400,
  HUBBARD: 400,
  GRAND: 500,
  OHIO: 600,
  ONTARIO: 630,
  ERIE: 660,
  HURON: 700,
  SUPERIOR: 730,
  CHICAGO: 800,
  INSTITUTE: 850,
  DIVISION: 1200,
  ELM: 1100,
  CEDAR: 1100,
  SCOTT: 1200,
  GOETHE: 1300,
  SCHILLER: 1400,
  BURTON: 1500,
  NORTH: 1600,
  CONCORD: 1700,
  ARMITAGE: 2000,
  DICKENS: 2100,
  WEBSTER: 2200,
  BELDEN: 2300,
  FULLERTON: 2400,
  WRIGHTWOOD: 2600,
  DIVERSEY: 2800,
  WELLINGTON: 3000,
  BELMONT: 3200,
  BARRY: 3100,
  NELSON: 3100,
  ROSCOE: 3400,
  SCHOOL: 3300,
  ADDISON: 3600,
  WAVELAND: 3700,
  GRACE: 3800,
  IRVING_PARK: 4000,
  MONTROSE: 4400,
  WILSON: 4600,
  LAWRENCE: 4800,
  LELAND: 4700,
  ARGYLE: 5000,
  FOSTER: 5200,
  BRYN_MAWR: 5600,
  HOLLYWOOD: 5700,
  THORNDALE: 5900,
  GRANVILLE: 6000,
  ROSEMONT: 6100,
  DEVON: 6400,
  PRATT: 6800,
  TOUHY: 7200,
  HOWARD: 7600,
  JUNEWAY: 7700,
  ROGERS: 7200,
  MORSE: 6900,
  JARVIS: 7400,
  GREENLEAF: 7000,
  LUNT: 7000,
  FARWELL: 7100,
  CHASE: 7300,
  // South side
  HARRISON: 600,
  POLK: 800,
  TAYLOR: 1000,
  ROOSEVELT: 1200,
  '16TH': 1600,
  '18TH': 1800,
  CERMAK: 2200,
  '26TH': 2600,
  '31ST': 3100,
  PERSHING: 3900,
  '35TH': 3500,
  '39TH': 3900,
  '43RD': 4300,
  '47TH': 4700,
  '51ST': 5100,
  '55TH': 5500,
  '59TH': 5900,
  MIDWAY: 5900,
  '63RD': 6300,
  MARQUETTE: 6700,
  '71ST': 7100,
  '75TH': 7500,
  '79TH': 7900,
  '83RD': 8300,
  '87TH': 8700,
  '91ST': 9100,
  '95TH': 9500,
  '99TH': 9900,
  '103RD': 10300,
  '107TH': 10700,
  '111TH': 11100,
  '115TH': 11500,
  '119TH': 11900,
  '123RD': 12300,
  '127TH': 12700,
  '130TH': 13000,
  GLADYS: 700,
  VAN_BUREN: 400,
  CONGRESS: 500,
  JACKSON: 300,
  ADAMS: 200,
  MONROE: 100,
  GARFIELD: 5500,
};

/**
 * Convert a permit zone record to a GeoJSON LineString feature.
 *
 * For N/S streets: the address range gives latitude extent; we look up
 * the street's longitude from the table.
 *
 * For E/W streets: the address range gives longitude extent; we look up
 * the street's latitude from the table.
 */
function permitZoneToFeature(
  zone: any,
): { type: 'Feature'; geometry: any; properties: any } | null {
  const dir = zone.street_direction; // N, S, E, W
  const name = (zone.street_name || '').toUpperCase().replace(/\s+/g, '_');
  const addrLow = zone.address_range_low;
  const addrHigh = zone.address_range_high;

  if (!dir || !addrLow || !addrHigh) return null;

  let startLat: number, startLng: number, endLat: number, endLng: number;

  if (dir === 'N' || dir === 'S') {
    // Street runs N-S. Address range = N-S extent. Need E-W cross-street addr for longitude.
    // Look in the EAST tables first (Michigan, Indiana, etc.) then WEST
    const ewAddr = NS_STREET_EW_ADDR[name];
    if (ewAddr === undefined) return null; // unknown street

    // Is it east or west of State St? Check if it's in common east-side streets
    // For simplicity: if the EW addr < 200 and street is on east side, use positive;
    // Most permit zones are on the W side, so default to West
    const isEast =
      [
        'MICHIGAN',
        'WABASH',
        'INDIANA',
        'PRAIRIE',
        'CALUMET',
        'KING_DRIVE',
        'COTTAGE_GROVE',
        'DREXEL',
        'ELLIS',
        'GREENWOOD',
        'WOODLAWN',
        'UNIVERSITY',
        'KIMBARK',
        'KENWOOD',
        'DORCHESTER',
        'BLACKSTONE',
        'HARPER',
        'LAKE_PARK',
        'STONY_ISLAND',
        'YATES',
        'COLES',
        'AVENUE_O',
        'EWING',
        'TORRENCE',
        'BRANDON',
        'CREGIER',
        'CLYDE',
        'JEFFERY',
        'CHAPPEL',
        'CRANDON',
        'OGLESBY',
        'PAXTON',
        'MERRILL',
        'EUCLID',
        'EAST_END',
        'BENNETT',
        'MANISTEE',
        'EXCHANGE',
        'SAGINAW',
        'MUSKEGON',
        'HOUSTON',
        'FARRELL',
      ].includes(name);

    const crossLng = isEast
      ? STATE_LNG + ewAddr * LNG_PER_ADDR
      : STATE_LNG - ewAddr * LNG_PER_ADDR;

    const sign = dir === 'N' ? 1 : -1;
    startLat = MADISON_LAT + sign * addrLow * LAT_PER_ADDR;
    endLat = MADISON_LAT + sign * addrHigh * LAT_PER_ADDR;
    startLng = crossLng;
    endLng = crossLng;
  } else if (dir === 'E' || dir === 'W') {
    // Street runs E-W. Address range = E-W extent. Need N-S cross-street addr for latitude.
    const nsAddr = EW_STREET_NS_ADDR[name];
    if (nsAddr === undefined) return null; // unknown street

    // Determine if the street is north or south of Madison
    // Most named streets with EW prefix are well-known; the table has the absolute addr
    // For numbered streets in the south (e.g., 47TH), they're south
    const isSouth =
      name.match(/^\d/) ||
      [
        'HARRISON',
        'POLK',
        'TAYLOR',
        'ROOSEVELT',
        'CERMAK',
        'PERSHING',
        'GARFIELD',
        'MIDWAY',
        'GLADYS',
      ].includes(name);

    const crossLat = isSouth
      ? MADISON_LAT - nsAddr * LAT_PER_ADDR
      : MADISON_LAT + nsAddr * LAT_PER_ADDR;

    const sign = dir === 'E' ? 1 : -1;
    startLng = STATE_LNG + sign * addrLow * LNG_PER_ADDR;
    endLng = STATE_LNG + sign * addrHigh * LNG_PER_ADDR;
    startLat = crossLat;
    endLat = crossLat;
  } else {
    return null;
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: [
        [startLng, startLat],
        [endLng, endLat],
      ],
    },
    properties: {
      zone: zone.zone,
      street: `${dir} ${zone.street_name} ${zone.street_type || ''}`.trim(),
      addrRange: `${addrLow}–${addrHigh}`,
      oddEven: zone.odd_even,
    },
  };
}

// ---------------------------------------------------------------------------
// API Handler
// ---------------------------------------------------------------------------

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

    // Fetch active permit zones
    let query = supabaseAdmin
      .from('parking_permit_zones')
      .select(
        'zone, street_direction, street_name, street_type, address_range_low, address_range_high, odd_even',
      )
      .eq('status', 'ACTIVE');

    if (zoneFilter) {
      query = query.eq('zone', zoneFilter);
    }

    const { data: zones, error } = await query;

    if (error) {
      console.error('[permit-zone-lines] DB error:', error.message);
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (!zones || zones.length === 0) {
      return res.status(200).json({ features: [], count: 0 });
    }

    // Convert to GeoJSON features
    let features = zones
      .map(permitZoneToFeature)
      .filter(Boolean) as any[];

    // Filter by map bounds if provided
    if (boundsStr) {
      const [north, south, east, west] = boundsStr.split(',').map(Number);
      if (!isNaN(north) && !isNaN(south) && !isNaN(east) && !isNaN(west)) {
        features = features.filter((f) => {
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

    // Deduplicate overlapping segments on the same street
    // (Multiple zones can cover the same block)
    // Group by approximate coordinates and take the first
    const seen = new Set<string>();
    const deduped = features.filter((f) => {
      const c = f.geometry.coordinates;
      // Round to ~10m precision for dedup
      const key = `${c[0][1].toFixed(4)},${c[0][0].toFixed(4)}_${c[1][1].toFixed(4)},${c[1][0].toFixed(4)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Cache for 5 minutes
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');

    return res.status(200).json({
      features: deduped,
      count: deduped.length,
      total: zones.length,
      resolved: features.length,
    });
  } catch (err) {
    console.error('[permit-zone-lines] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
