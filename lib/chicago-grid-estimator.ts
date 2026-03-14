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
 * Estimate a Chicago house number from GPS coordinates.
 *
 * @param lat  Latitude of the location
 * @param lng  Longitude of the location
 * @param orientation  Whether the street runs N-S or E-W
 * @returns Estimated house number (always positive, rounded to nearest even integer
 *          for consistency — can be adjusted to odd/even based on side-of-street)
 */
export function estimateHouseNumber(
  lat: number,
  lng: number,
  orientation: StreetOrientation,
): number {
  let raw: number;

  if (orientation === 'N-S') {
    // N-S street: house number = distance from Madison (latitude)
    raw = Math.abs(lat - MADISON_LAT) * NS_SCALE;
  } else {
    // E-W street: house number = distance from State (longitude)
    raw = Math.abs(lng - STATE_LNG) * EW_SCALE;
  }

  // Round to nearest whole number, minimum 1
  const estimated = Math.max(1, Math.round(raw));

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
 */
export function estimateAddressFromGps(
  lat: number,
  lng: number,
  roadName: string,
  direction?: string | null,
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

  const houseNumber = estimateHouseNumber(lat, lng, orientation);

  return {
    houseNumber,
    direction: dir,
    orientation,
  };
}
