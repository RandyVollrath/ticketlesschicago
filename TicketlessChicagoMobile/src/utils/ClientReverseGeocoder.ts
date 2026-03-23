/**
 * Client-side reverse geocoding utility.
 *
 * Falls back to Nominatim (OpenStreetMap) directly from the mobile client
 * when the server-side reverse geocoder fails and returns raw coordinates
 * instead of a street address.
 *
 * This is a LAST-RESORT fallback — the server-side geocoder (Nominatim + Google)
 * should handle 99% of cases. This catches transient server failures, timeouts,
 * and network issues that cause coordinates to leak into the address field.
 */

import Logger from './Logger';

const log = Logger.createLogger('ClientReverseGeocoder');

const NOMINATIM_TIMEOUT_MS = 5000;

/**
 * Check if a string looks like raw coordinates instead of a real address.
 * Matches:
 *   "41.939123, -87.667456"  (raw coordinates)
 *   "Near 41.9391, -87.6675" (fallback format)
 * Real addresses contain letters (street names, city, state).
 */
export function isCoordinateAddress(address: string | undefined | null): boolean {
  if (!address) return true;
  const trimmed = address.trim();
  // Raw coordinates: "41.939123, -87.667456"
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(trimmed)) return true;
  // Fallback format: "Near 41.9391, -87.6675"
  if (/^Near\s+-?\d+\.\d+,\s*-?\d+\.\d+$/.test(trimmed)) return true;
  return false;
}

/**
 * Format a coordinate-based fallback address as "Near [lat], [lng]"
 * for display when all geocoding attempts fail.
 * This is more user-friendly than raw coordinates.
 */
export function formatCoordinateFallback(lat: number, lng: number): string {
  return `Near ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

/**
 * Attempt client-side reverse geocoding via Nominatim.
 * Returns a formatted address string or null on failure.
 *
 * @param lat Latitude
 * @param lng Longitude
 * @returns Formatted address or null
 */
export async function clientReverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), NOMINATIM_TIMEOUT_MS);

    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TicketlessChicago/1.0 (parking app)',
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.warn(`Nominatim returned ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (!data || data.error) {
      log.warn('Nominatim returned error:', data?.error);
      return null;
    }

    // Build a clean Chicago address from the address details
    const addr = data.address;
    if (addr) {
      const parts: string[] = [];

      // House number + street
      const houseNumber = addr.house_number;
      const road = addr.road || addr.pedestrian || addr.footway;
      if (road) {
        parts.push(houseNumber ? `${houseNumber} ${road}` : road);
      }

      // Neighborhood or suburb (useful context)
      const neighborhood = addr.neighbourhood || addr.suburb;
      if (neighborhood && parts.length > 0) {
        parts.push(neighborhood);
      }

      if (parts.length > 0) {
        return parts.join(', ');
      }
    }

    // Fall back to display_name if address details didn't work
    if (data.display_name) {
      // Nominatim display_name is very long — trim to street + neighborhood
      const segments = data.display_name.split(',').map((s: string) => s.trim());
      // Take first 2-3 segments (usually street + neighborhood + city)
      return segments.slice(0, 3).join(', ');
    }

    return null;
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      log.warn('Client reverse geocode timed out');
    } else {
      log.warn('Client reverse geocode failed:', error?.message || error);
    }
    return null;
  }
}

/**
 * Resolve an address, using client-side geocoding as fallback.
 * If the provided address looks like coordinates, attempt to resolve it.
 * Returns the original address if it's already a real address, or the
 * resolved address, or a user-friendly "Near X, Y" fallback.
 */
export async function resolveAddress(
  address: string | undefined | null,
  lat: number,
  lng: number
): Promise<string> {
  // If we already have a real address, return it
  if (address && !isCoordinateAddress(address)) {
    return address;
  }

  // Try client-side reverse geocoding
  const resolved = await clientReverseGeocode(lat, lng);
  if (resolved) {
    log.info(`Client geocode resolved: "${resolved}" for ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    return resolved;
  }

  // Last resort: user-friendly coordinate fallback
  return formatCoordinateFallback(lat, lng);
}
