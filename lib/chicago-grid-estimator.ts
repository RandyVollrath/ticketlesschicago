/**
 * Chicago Address Grid Estimator
 *
 * Estimates a street address number from GPS coordinates using Chicago's
 * remarkably consistent address grid system.
 *
 * Chicago's grid:
 *   - N/S baseline: Madison Street (0 N/S) at ~41.88185°N
 *   - E/W baseline: State Street (0 E/W) at ~-87.62755°W
 *   - Scale: 800 addresses = 1 mile
 *   - Odd addresses = north/west side, even = south/east side
 *
 * Calibrated from known reference points:
 *   - North Ave (1600 N) = 41.9103°N  → NS scale ≈ 56,206/deg
 *   - Fullerton (2400 N) = 41.9253°N  → NS scale ≈ 55,300/deg
 *   - Diversey (2800 N) = 41.9322°N   → NS scale ≈ 55,596/deg
 *   - Halsted (800 W) = -87.6464°W    → EW scale ≈ 42,462/deg
 *   - Western (2400 W) = -87.6847°W   → EW scale ≈ 42,005/deg
 *
 * Accuracy: typically within ±50 addresses (~half a block) in the
 * regular grid. Less accurate in diagonal/curved streets (e.g., Elston,
 * Clark north of Diversey) or far south/west where the grid bends.
 */

// Baselines (latitude/longitude of the 0-address origin)
const MADISON_LAT = 41.88185; // Madison St = 0 N/S
const STATE_LNG = -87.62755; // State St = 0 E/W

// Scale factors (addresses per degree), averaged from multiple reference points
const NS_SCALE = 55_700; // ~55,700 addresses per degree of latitude
const EW_SCALE = 42_200; // ~42,200 addresses per degree of longitude

/**
 * Street orientation in Chicago's grid.
 * N-S streets: Kenmore, Halsted, Western — house numbers increase N/S from Madison
 * E-W streets: Fullerton, Lawrence, Madison — house numbers increase E/W from State
 */
export type StreetOrientation = 'N-S' | 'E-W';

/**
 * Determine street orientation from the direction prefix.
 *
 * In Chicago:
 *   - Streets prefixed N/S (e.g., "N Kenmore Ave") run north-south.
 *     Their address number comes from the E-W position (distance from State St).
 *     Wait — that's wrong. Let me think again.
 *
 * Actually:
 *   - A "N Kenmore Ave" address means the address is NORTH of Madison.
 *     Kenmore runs N-S. The number (e.g., 2378) tells you how far
 *     north of Madison you are.
 *   - A "W Fullerton Ave" address means the address is WEST of State.
 *     Fullerton runs E-W. The number (e.g., 1045) tells you how far
 *     west of State you are.
 *
 * So: direction prefix N or S → street runs N-S → use latitude to estimate.
 *     direction prefix W or E → street runs E-W → use longitude to estimate.
 */
export function getOrientationFromDirection(direction: string | null): StreetOrientation | null {
  if (!direction) return null;
  const d = direction.toUpperCase().trim();
  if (d === 'N' || d === 'S') return 'N-S';
  if (d === 'E' || d === 'W') return 'E-W';
  return null;
}

/**
 * Infer the direction prefix from street orientation and GPS position.
 *
 * If the street runs N-S and we're north of Madison → "N"
 * If the street runs E-W and we're west of State → "W"
 */
export function inferDirection(
  lat: number,
  lng: number,
  orientation: StreetOrientation,
): string {
  if (orientation === 'N-S') {
    return lat >= MADISON_LAT ? 'N' : 'S';
  } else {
    return lng <= STATE_LNG ? 'W' : 'E';
  }
}

/**
 * Snap geometry from snap_to_nearest_street, used for side-of-street parity.
 */
export interface SnapGeometry {
  snappedLat: number;
  snappedLng: number;
  streetBearing: number; // 0-360°, clockwise from north
}

/**
 * Determine which side of the street centerline a GPS point is on.
 *
 * Uses the cross product of the street's bearing vector and the vector
 * from the snapped (centerline) point to the raw GPS point.
 *
 * Chicago convention:
 *   N-S streets: odd = east side, even = west side
 *   E-W streets: odd = south side, even = north side
 *
 * Returns 'odd' or 'even', or null if the point is too close to call
 * (within ~2m of the centerline — about 0.00002° at Chicago's latitude).
 */
export function determineSideOfStreetParity(
  rawLat: number,
  rawLng: number,
  snap: SnapGeometry,
  orientation: StreetOrientation,
): 'odd' | 'even' | null {
  // Vector from snapped point to raw GPS point
  const dLat = rawLat - snap.snappedLat;
  const dLng = rawLng - snap.snappedLng;

  // If essentially on the centerline, can't determine side
  if (Math.abs(dLat) < 0.00002 && Math.abs(dLng) < 0.00002) return null;

  // Street bearing vector (bearing is clockwise from north)
  const bearingRad = (snap.streetBearing * Math.PI) / 180;
  const bearingDLat = Math.cos(bearingRad); // north component
  const bearingDLng = Math.sin(bearingRad); // east component

  // 2D cross product: positive = GPS point is to the RIGHT of the bearing vector
  // (i.e., if you're walking in the bearing direction, the point is on your right)
  const cross = bearingDLng * dLat - bearingDLat * dLng;

  // For N-S streets (bearing ~0° or ~180°):
  //   Bearing ~0° (north): right side = east = odd
  //   Bearing ~180° (south): right side = west = even
  // For E-W streets (bearing ~90° or ~270°):
  //   Bearing ~90° (east): right side = south = odd
  //   Bearing ~270° (west): right side = north = even
  //
  // Normalize: figure out which direction the bearing points in the primary axis
  if (orientation === 'N-S') {
    // Primary axis is latitude. Bearing ~0° = northward, ~180° = southward
    const isNorthward = Math.cos(bearingRad) > 0;
    // cross > 0 = right of bearing direction
    if (isNorthward) {
      // Walking north: right = east = odd
      return cross > 0 ? 'odd' : 'even';
    } else {
      // Walking south: right = west = even
      return cross > 0 ? 'even' : 'odd';
    }
  } else {
    // E-W street. Primary axis is longitude. Bearing ~90° = eastward, ~270° = westward
    const isEastward = Math.sin(bearingRad) > 0;
    if (isEastward) {
      // Walking east: right = south = odd
      return cross > 0 ? 'odd' : 'even';
    } else {
      // Walking west: right = north = even
      return cross > 0 ? 'even' : 'odd';
    }
  }
}

/**
 * Estimate a Chicago house number from GPS coordinates.
 *
 * @param lat  Latitude of the location
 * @param lng  Longitude of the location
 * @param orientation  Whether the street runs N-S or E-W
 * @param forceParity  If provided, forces the house number to the correct odd/even
 *   side. This is determined by comparing the raw GPS point against the street
 *   centerline — much more reliable than letting rounding pick a side randomly.
 * @returns Estimated house number (always positive)
 */
export function estimateHouseNumber(
  lat: number,
  lng: number,
  orientation: StreetOrientation,
  forceParity?: 'odd' | 'even' | null,
): number {
  let raw: number;

  if (orientation === 'N-S') {
    // N-S street: house number = distance from Madison (latitude)
    raw = Math.abs(lat - MADISON_LAT) * NS_SCALE;
  } else {
    // E-W street: house number = distance from State (longitude)
    raw = Math.abs(lng - STATE_LNG) * EW_SCALE;
  }

  let estimated = Math.max(1, Math.round(raw));

  // Force odd/even parity when we know which side of the street the user is on
  if (forceParity) {
    const isOdd = estimated % 2 === 1;
    if (forceParity === 'odd' && !isOdd) {
      // Prefer subtracting by 1 (closer to centerline = more conservative)
      estimated = Math.max(1, estimated - 1);
    } else if (forceParity === 'even' && isOdd) {
      estimated = estimated + 1;
    }
  }

  return estimated;
}

/**
 * Determine the 100-block for database lookups.
 * E.g., house number 2378 → block 2300
 */
export function getBlock(houseNumber: number): number {
  return Math.floor(houseNumber / 100) * 100;
}

/**
 * Full estimation: given GPS coordinates and a street name (from Nominatim),
 * estimate the house number using the grid system.
 *
 * If the street's direction prefix is known (e.g., "North Kenmore Avenue"
 * → direction = "N"), we use it to determine orientation.
 *
 * If not known, we try to infer from Nominatim's road name:
 *   "North Kenmore Avenue" → N → N-S street
 *   "West Fullerton Avenue" → W → E-W street
 *
 * @param snapGeometry  Optional snap-to-street result. When provided, determines
 *   which side of the street centerline the GPS point is on and forces the house
 *   number to the correct odd/even parity. This prevents the ±1 rounding ambiguity
 *   that causes side-of-street misidentification on narrow streets.
 * @param rawLat/rawLng  Original (un-snapped) GPS coordinates. Required when
 *   snapGeometry is provided, since the primary lat/lng may be snapped to the
 *   centerline (making side detection impossible). Falls back to lat/lng if omitted.
 */
export function estimateAddressFromGps(
  lat: number,
  lng: number,
  roadName: string,
  direction?: string | null,
  snapGeometry?: SnapGeometry | null,
  rawLat?: number,
  rawLng?: number,
): { houseNumber: number; direction: string; orientation: StreetOrientation } | null {
  // Try to get orientation from explicit direction
  let orientation = direction ? getOrientationFromDirection(direction) : null;
  let dir = direction?.toUpperCase().trim() || null;

  // If no direction provided, try to extract from road name
  // Nominatim returns e.g., "North Kenmore Avenue", "West Fullerton Avenue"
  if (!orientation && roadName) {
    const dirMatch = roadName.match(/^(North|South|East|West)\s/i);
    if (dirMatch) {
      const dirWord = dirMatch[1].toUpperCase();
      const dirMap: Record<string, string> = {
        NORTH: 'N',
        SOUTH: 'S',
        EAST: 'E',
        WEST: 'W',
      };
      dir = dirMap[dirWord] || null;
      orientation = dir ? getOrientationFromDirection(dir) : null;
    }
  }

  // If we still don't know the orientation, we can't estimate
  if (!orientation) return null;

  // If we have orientation but no direction, infer from position
  if (!dir) {
    dir = inferDirection(lat, lng, orientation);
  }

  // Determine parity from snap geometry (which side of the centerline is the GPS point on?)
  let forceParity: 'odd' | 'even' | null = null;
  if (snapGeometry && snapGeometry.streetBearing >= 0) {
    // Use raw (un-snapped) GPS coords for the side check — the snapped coords
    // are ON the centerline and can't tell us which side we're on
    const checkLat = rawLat ?? lat;
    const checkLng = rawLng ?? lng;
    forceParity = determineSideOfStreetParity(checkLat, checkLng, snapGeometry, orientation);
    if (forceParity) {
      console.log(
        `[grid-estimator] Side-of-centerline parity: raw GPS is on the ${forceParity} side ` +
          `(${orientation === 'N-S' ? (forceParity === 'odd' ? 'east' : 'west') : (forceParity === 'odd' ? 'south' : 'north')}) ` +
          `of ${dir} ${roadName}`,
      );
    }
  }

  const houseNumber = estimateHouseNumber(lat, lng, orientation, forceParity);

  return {
    houseNumber,
    direction: dir,
    orientation,
  };
}
