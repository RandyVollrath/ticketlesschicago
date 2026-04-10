/**
 * Reverse Geocoding Service — Nominatim-first with Google Maps fallback
 *
 * Strategy:
 *   1. Try Nominatim (OpenStreetMap) — free, no API key, more accurate at
 *      identifying the actual street you're on (doesn't "promote" to major streets)
 *   2. If Nominatim returns no house number, estimate one using Chicago's address
 *      grid system (Madison/State baselines, ~55,700 N/S addresses per degree)
 *   3. If Nominatim fails entirely (timeout, down), fall back to Google Maps API
 *
 * This eliminates the previous dual-geocoder bug where the unified parking checker
 * used Google (which returned wrong-street addresses near intersections) and the
 * metered parking checker used Nominatim independently.
 */

import { estimateAddressFromGps, type SnapGeometry } from './chicago-grid-estimator';

// ---------------------------------------------------------------------------
// Shared result type (used by all consumers)
// ---------------------------------------------------------------------------

export interface GeocodeResult {
  formatted_address: string;
  street_name: string | null;
  street_number: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  neighborhood: string | null;
  /** Which geocoder produced this result */
  source: 'nominatim' | 'nominatim+grid' | 'google';
}

// Backwards-compatible alias
export type ReverseGeocodeResult = GeocodeResult;

// ---------------------------------------------------------------------------
// Cache (shared across all geocoder paths)
// ---------------------------------------------------------------------------

const geocodeCache = new Map<string, { result: GeocodeResult; timestamp: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (reduced from 24h — addresses don't change but we want fresh results during debugging)
const MAX_CACHE_SIZE = 1000;

function getCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function getCached(lat: number, lng: number): GeocodeResult | null {
  const key = getCacheKey(lat, lng);
  const entry = geocodeCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.result;
  }
  return null;
}

function setCache(lat: number, lng: number, result: GeocodeResult): void {
  cleanupCache();
  geocodeCache.set(getCacheKey(lat, lng), { result, timestamp: Date.now() });
}

// ---------------------------------------------------------------------------
// Nominatim reverse geocode
// ---------------------------------------------------------------------------

/**
 * Reverse geocode via Nominatim (OpenStreetMap). Free, no API key.
 * Returns the raw road name and optional house number.
 */
async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
): Promise<{
  road: string;
  houseNumber: string | null;
  suburb: string | null;
  postcode: string | null;
} | null> {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1`,
      {
        headers: { 'User-Agent': 'TicketlessChicago/1.0 (parking-checker)' },
        signal: AbortSignal.timeout(3000),
      },
    );

    if (!resp.ok) return null;
    const data = await resp.json();

    const road: string | undefined = data.address?.road;
    if (!road) return null;

    return {
      road,
      houseNumber: data.address?.house_number || null,
      suburb: data.address?.suburb || data.address?.neighbourhood || null,
      postcode: data.address?.postcode || null,
    };
  } catch (err) {
    console.warn('[reverse-geocoder] Nominatim failed:', err);
    return null;
  }
}

/**
 * Parse a Nominatim road name like "North Kenmore Avenue" into components:
 *   direction = "N", streetName = "Kenmore", streetType = "Avenue"
 */
function parseNominatimRoad(road: string): {
  direction: string | null;
  streetName: string;
  streetType: string | null;
} {
  const parts = road.trim().split(/\s+/);

  // Extract direction prefix
  let direction: string | null = null;
  let startIdx = 0;
  const dirMap: Record<string, string> = {
    NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
    N: 'N', S: 'S', E: 'E', W: 'W',
  };
  if (parts.length > 1 && dirMap[parts[0].toUpperCase()]) {
    direction = dirMap[parts[0].toUpperCase()];
    startIdx = 1;
  }

  // Extract street type suffix
  const typeMap: Record<string, string> = {
    AVENUE: 'Ave', AVE: 'Ave',
    STREET: 'St', ST: 'St',
    BOULEVARD: 'Blvd', BLVD: 'Blvd',
    DRIVE: 'Dr', DR: 'Dr',
    ROAD: 'Rd', RD: 'Rd',
    LANE: 'Ln', LN: 'Ln',
    PLACE: 'Pl', PL: 'Pl',
    COURT: 'Ct', CT: 'Ct',
    PARKWAY: 'Pkwy', PKWY: 'Pkwy',
    TERRACE: 'Ter', TER: 'Ter',
    WAY: 'Way',
  };
  let streetType: string | null = null;
  let endIdx = parts.length;
  if (parts.length > 1 && typeMap[parts[parts.length - 1].toUpperCase()]) {
    streetType = typeMap[parts[parts.length - 1].toUpperCase()];
    endIdx = parts.length - 1;
  }

  const streetName = parts.slice(startIdx, endIdx).join(' ');

  return { direction, streetName, streetType };
}

// ---------------------------------------------------------------------------
// Google Maps reverse geocode (fallback)
// ---------------------------------------------------------------------------

async function reverseGeocodeGoogle(
  lat: number,
  lng: number,
): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('[reverse-geocoder] Google Maps API key not configured');
    return null;
  }

  try {
    let data: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`,
          { signal: AbortSignal.timeout(5000) },
        );
        if (!response.ok) throw new Error(`Google geocode HTTP ${response.status}`);
        data = await response.json();
        if (data.status === 'OK' && data.results?.length > 0) break;
        if (attempt === 0) await new Promise(r => setTimeout(r, 500));
      } catch (err) {
        if (attempt === 0) {
          console.warn('[reverse-geocoder] Google attempt 1 failed, retrying');
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw err;
      }
    }

    if (!data || data.status !== 'OK' || !data.results?.length) return null;

    const result = data.results[0];
    const comps = result.address_components || [];

    const parsed: GeocodeResult = {
      formatted_address: result.formatted_address || '',
      street_name: null,
      street_number: null,
      city: null,
      state: null,
      zip_code: null,
      neighborhood: null,
      source: 'google',
    };

    for (const c of comps) {
      const types = c.types;
      if (types.includes('street_number')) parsed.street_number = c.long_name;
      else if (types.includes('route')) parsed.street_name = c.long_name;
      else if (types.includes('locality')) parsed.city = c.long_name;
      else if (types.includes('administrative_area_level_1')) parsed.state = c.short_name;
      else if (types.includes('postal_code')) parsed.zip_code = c.long_name;
      else if (types.includes('neighborhood') || types.includes('sublocality'))
        parsed.neighborhood = c.long_name;
    }

    return parsed;
  } catch (err) {
    console.error('[reverse-geocoder] Google fallback failed:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main entry point — Nominatim first, grid estimation, Google fallback
// ---------------------------------------------------------------------------

/**
 * Reverse geocode coordinates to address.
 *
 * Strategy:
 *   1. Check cache
 *   2. Try Nominatim (free, accurate street identification)
 *   3. If Nominatim has no house number, estimate via Chicago grid
 *   4. If Nominatim fails entirely, fall back to Google Maps
 *
 * @param snapGeometry  Optional snap-to-street geometry for side-of-street
 *   parity forcing. When provided (along with rawLat/rawLng), the grid estimator
 *   uses the GPS point's position relative to the street centerline to force the
 *   house number to the correct odd/even — preventing side-of-street misidentification.
 * @param rawLat/rawLng  Original un-snapped GPS coordinates. Needed when the
 *   primary lat/lng have been snapped to the centerline.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
  snapGeometry?: SnapGeometry | null,
  rawLat?: number,
  rawLng?: number,
): Promise<GeocodeResult | null> {
  // Check cache first
  const cached = getCached(latitude, longitude);
  if (cached) {
    console.log('[reverse-geocoder] Cache hit:', getCacheKey(latitude, longitude));
    return cached;
  }

  // --- Attempt 1: Nominatim ---
  const nominatim = await reverseGeocodeNominatim(latitude, longitude);

  if (nominatim) {
    const { direction, streetName, streetType } = parseNominatimRoad(nominatim.road);

    let streetNumber = nominatim.houseNumber;
    let source: GeocodeResult['source'] = 'nominatim';

    // If Nominatim didn't return a house number, estimate from GPS grid
    if (!streetNumber) {
      const gridEstimate = estimateAddressFromGps(
        latitude,
        longitude,
        nominatim.road,
        direction,
        snapGeometry,
        rawLat,
        rawLng,
      );
      if (gridEstimate) {
        streetNumber = String(gridEstimate.houseNumber);
        source = 'nominatim+grid';
        console.log(
          `[reverse-geocoder] Grid-estimated house number: ${streetNumber} ` +
            `(${gridEstimate.direction} ${streetName}, orientation=${gridEstimate.orientation})`,
        );
      }
    }

    // Build formatted address
    const dirAbbrev = direction || '';
    const typeStr = streetType || '';
    const fullStreetName = [dirAbbrev, streetName, typeStr].filter(Boolean).join(' ');
    const formattedAddress = streetNumber
      ? `${streetNumber} ${fullStreetName}, Chicago, IL${nominatim.postcode ? ' ' + nominatim.postcode : ''}`
      : `${fullStreetName}, Chicago, IL${nominatim.postcode ? ' ' + nominatim.postcode : ''}`;

    // street_name uses Nominatim's full road name (e.g., "North Kenmore Avenue")
    // for display, but the formatted_address uses abbreviated form
    const result: GeocodeResult = {
      formatted_address: formattedAddress,
      street_name: nominatim.road,
      street_number: streetNumber,
      city: 'Chicago',
      state: 'IL',
      zip_code: nominatim.postcode,
      neighborhood: nominatim.suburb,
      source,
    };

    console.log(
      `[reverse-geocoder] Nominatim → "${formattedAddress}" (source=${source})`,
    );

    setCache(latitude, longitude, result);
    return result;
  }

  // --- Attempt 2: Google Maps fallback ---
  console.log('[reverse-geocoder] Nominatim failed, falling back to Google Maps');
  const google = await reverseGeocodeGoogle(latitude, longitude);
  if (google) {
    console.log(
      `[reverse-geocoder] Google fallback → "${google.formatted_address}"`,
    );
    setCache(latitude, longitude, google);
    return google;
  }

  console.warn('[reverse-geocoder] All geocoders failed');
  return null;
}

// ---------------------------------------------------------------------------
// Convenience exports (maintained for backwards compatibility)
// ---------------------------------------------------------------------------

/**
 * Get just the street address (street number + street name)
 */
export async function getStreetAddress(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const result = await reverseGeocode(latitude, longitude);
  if (!result) return null;
  if (result.street_number && result.street_name) {
    return `${result.street_number} ${result.street_name}`;
  }
  if (result.street_name) return result.street_name;
  return result.formatted_address;
}

/**
 * Get formatted address suitable for display
 */
export async function getFormattedAddress(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const result = await reverseGeocode(latitude, longitude);
  return result ? result.formatted_address : null;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

function cleanupCache() {
  const now = Date.now();
  const toDelete: string[] = [];
  geocodeCache.forEach((value, key) => {
    if (now - value.timestamp > CACHE_TTL_MS) {
      toDelete.push(key);
    }
  });
  toDelete.forEach(key => geocodeCache.delete(key));

  if (geocodeCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(geocodeCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    entries.slice(0, geocodeCache.size - MAX_CACHE_SIZE).forEach(([k]) => geocodeCache.delete(k));
  }
}

export function clearGeocodeCache() {
  geocodeCache.clear();
  console.log('[reverse-geocoder] Cache cleared');
}

export function getGeocodeStats() {
  const now = Date.now();
  let valid = 0;
  let expired = 0;
  geocodeCache.forEach((v) => {
    if (now - v.timestamp < CACHE_TTL_MS) valid++;
    else expired++;
  });
  return {
    total_entries: geocodeCache.size,
    valid_entries: valid,
    expired_entries: expired,
    cache_ttl_hours: CACHE_TTL_MS / (1000 * 60 * 60),
    max_cache_size: MAX_CACHE_SIZE,
  };
}
