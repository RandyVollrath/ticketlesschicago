/**
 * Reverse Geocoding Cache Service
 *
 * Converts GPS coordinates to street addresses using Google Maps API
 * Implements caching to reduce API costs
 */

// Simple in-memory cache
// In production, consider using Redis for distributed caching
const geocodeCache = new Map<string, { address: string; timestamp: number }>();

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_SIZE = 1000;

interface ReverseGeocodeResult {
  formatted_address: string;
  street_name: string | null;
  street_number: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  neighborhood: string | null;
}

/**
 * Reverse geocode coordinates to address with caching
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ReverseGeocodeResult | null> {
  // Round coordinates to 5 decimal places (~1m precision) for cache key
  const lat = latitude.toFixed(5);
  const lng = longitude.toFixed(5);
  const cacheKey = `${lat},${lng}`;

  // Check cache first
  const cached = geocodeCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    console.log('Reverse geocode cache hit:', cacheKey);
    return JSON.parse(cached.address);
  }

  // Check if Google Maps API key is configured
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('Google Maps API key not configured (checked GOOGLE_MAPS_API_KEY and GOOGLE_API_KEY)');
    return null;
  }

  try {
    console.log('Reverse geocoding:', { latitude, longitude });

    // Retry once on transient failures (timeout, network error, 5xx)
    let data: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=${apiKey}`,
          {
            signal: AbortSignal.timeout(5000), // 5 second timeout
          }
        );

        if (!response.ok) {
          throw new Error(`Geocoding API error: ${response.status}`);
        }

        data = await response.json();

        if (data.status === 'OK' && data.results && data.results.length > 0) {
          break; // Success
        }

        // Non-OK status — retry if first attempt
        if (attempt === 0) {
          console.warn(`Geocoding attempt ${attempt + 1} returned ${data.status}, retrying...`);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
      } catch (fetchError) {
        if (attempt === 0) {
          console.warn('Geocoding attempt 1 failed, retrying:', fetchError);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        throw fetchError; // Re-throw on final attempt
      }
    }

    if (!data || data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.warn('Geocoding returned no results after retries:', data?.status);
      return null;
    }

    const result = data.results[0];
    const addressComponents = result.address_components || [];

    // Parse address components
    const parsed: ReverseGeocodeResult = {
      formatted_address: result.formatted_address || '',
      street_name: null,
      street_number: null,
      city: null,
      state: null,
      zip_code: null,
      neighborhood: null,
    };

    for (const component of addressComponents) {
      const types = component.types;

      if (types.includes('street_number')) {
        parsed.street_number = component.long_name;
      } else if (types.includes('route')) {
        parsed.street_name = component.long_name;
      } else if (types.includes('locality')) {
        parsed.city = component.long_name;
      } else if (types.includes('administrative_area_level_1')) {
        parsed.state = component.short_name;
      } else if (types.includes('postal_code')) {
        parsed.zip_code = component.long_name;
      } else if (types.includes('neighborhood') || types.includes('sublocality')) {
        parsed.neighborhood = component.long_name;
      }
    }

    // Cache the result
    cleanupCache(); // Prevent unbounded growth
    geocodeCache.set(cacheKey, {
      address: JSON.stringify(parsed),
      timestamp: Date.now(),
    });

    return parsed;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
}

/**
 * Get just the street address (street number + street name)
 */
export async function getStreetAddress(
  latitude: number,
  longitude: number
): Promise<string | null> {
  const result = await reverseGeocode(latitude, longitude);

  if (!result) return null;

  if (result.street_number && result.street_name) {
    return `${result.street_number} ${result.street_name}`;
  }

  if (result.street_name) {
    return result.street_name;
  }

  // Fallback to formatted address
  return result.formatted_address;
}

/**
 * Get formatted address suitable for display
 */
export async function getFormattedAddress(
  latitude: number,
  longitude: number
): Promise<string | null> {
  const result = await reverseGeocode(latitude, longitude);
  return result ? result.formatted_address : null;
}

/**
 * Clear expired entries from cache
 */
function cleanupCache() {
  const now = Date.now();
  const toDelete: string[] = [];

  for (const [key, value] of geocodeCache.entries()) {
    if (now - value.timestamp > CACHE_TTL_MS) {
      toDelete.push(key);
    }
  }

  toDelete.forEach(key => geocodeCache.delete(key));

  // If still too large, remove oldest entries
  if (geocodeCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(geocodeCache.entries());
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    const numToRemove = geocodeCache.size - MAX_CACHE_SIZE;
    entries.slice(0, numToRemove).forEach(([key]) => geocodeCache.delete(key));
  }
}

/**
 * Manually clear all cache entries
 */
export function clearGeocodeCache() {
  geocodeCache.clear();
  console.log('Geocode cache cleared');
}

/**
 * Get cache statistics
 */
export function getGeocodeStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const value of geocodeCache.values()) {
    if (now - value.timestamp < CACHE_TTL_MS) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    total_entries: geocodeCache.size,
    valid_entries: validEntries,
    expired_entries: expiredEntries,
    cache_ttl_hours: CACHE_TTL_MS / (1000 * 60 * 60),
    max_cache_size: MAX_CACHE_SIZE,
  };
}
