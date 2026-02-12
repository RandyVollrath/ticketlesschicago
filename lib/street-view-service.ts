/**
 * Google Street View Service
 *
 * Fetches Street View imagery metadata and static images for ticket locations.
 * Used to check for signage conditions at the time of the violation.
 *
 * Pricing: $7 per 1,000 requests (Street View Static API)
 * Free tier: $200/month credit = ~28,500 free lookups/month
 *
 * Flow:
 * 1. Use Street View Metadata API to check if imagery exists at the location
 * 2. If imagery exists, get the image date and panorama ID
 * 3. Generate a static image URL (don't download, just reference)
 * 4. Include the metadata + URL in the evidence bundle for Claude
 */

export interface StreetViewResult {
  hasImagery: boolean;
  imageDate: string | null;      // e.g., "2024-07" (year-month from Google)
  panoramaId: string | null;
  imageUrl: string | null;        // Static image URL (640x400)
  thumbnailUrl: string | null;    // Smaller version (320x200)
  latitude: number | null;
  longitude: number | null;
  address: string | null;         // Street address used for lookup
  heading: number | null;         // Camera heading (0-360)
  signageObservation: string | null; // AI-generated observation about signage
}

const STREET_VIEW_METADATA_URL = 'https://maps.googleapis.com/maps/api/streetview/metadata';
const STREET_VIEW_STATIC_URL = 'https://maps.googleapis.com/maps/api/streetview';

/**
 * Check if Street View imagery exists at a location and get metadata.
 * Accepts either lat/lng coordinates or a street address string.
 */
export async function getStreetViewMetadata(
  location: string | { latitude: number; longitude: number }
): Promise<{ available: boolean; date: string | null; panoId: string | null; lat: number | null; lng: number | null }> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return { available: false, date: null, panoId: null, lat: null, lng: null };
  }

  try {
    const locationStr = typeof location === 'string'
      ? `${location}, Chicago, IL`
      : `${location.latitude},${location.longitude}`;

    const params = new URLSearchParams({
      location: locationStr,
      radius: '50', // Search within 50 meters
      key: apiKey,
    });

    const response = await fetch(`${STREET_VIEW_METADATA_URL}?${params}`);
    if (!response.ok) return { available: false, date: null, panoId: null, lat: null, lng: null };

    const data = await response.json();

    if (data.status !== 'OK') {
      return { available: false, date: null, panoId: null, lat: null, lng: null };
    }

    return {
      available: true,
      date: data.date || null,      // e.g., "2024-07"
      panoId: data.pano_id || null,
      lat: data.location?.lat || null,
      lng: data.location?.lng || null,
    };
  } catch (error) {
    console.error('Street View metadata error:', error);
    return { available: false, date: null, panoId: null, lat: null, lng: null };
  }
}

/**
 * Generate a Street View static image URL
 * Does NOT make an API call — just builds the URL
 * The image is fetched when Claude's letter is rendered or when Lob prints it
 *
 * Accepts either lat/lng or a panoId. If panoId is provided, it takes precedence.
 */
export function buildStreetViewUrl(
  location: { latitude: number; longitude: number } | null,
  options?: {
    heading?: number;
    pitch?: number;
    fov?: number;
    width?: number;
    height?: number;
    panoId?: string;
  }
): string | null {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  const params = new URLSearchParams({
    size: `${options?.width || 640}x${options?.height || 400}`,
    fov: String(options?.fov || 90),
    pitch: String(options?.pitch || 0),
    key: apiKey,
  });

  // Use panorama ID if available (most precise), otherwise lat/lng
  if (options?.panoId) {
    params.set('pano', options.panoId);
  } else if (location) {
    params.set('location', `${location.latitude},${location.longitude}`);
  } else {
    return null; // No location info at all
  }

  if (options?.heading !== undefined) {
    params.set('heading', String(options.heading));
  }

  return `${STREET_VIEW_STATIC_URL}?${params}`;
}

/**
 * Get Street View evidence for a ticket location.
 * Accepts either lat/lng coordinates or a street address string.
 * This is the main function called during letter generation.
 *
 * Returns imagery info that can be included in the Claude prompt
 * and optionally attached to the Lob letter.
 */
export async function getStreetViewEvidence(
  location: string | { latitude: number; longitude: number },
  violationDate?: string | null
): Promise<StreetViewResult> {
  const isAddress = typeof location === 'string';
  const result: StreetViewResult = {
    hasImagery: false,
    imageDate: null,
    panoramaId: null,
    imageUrl: null,
    thumbnailUrl: null,
    latitude: isAddress ? null : location.latitude,
    longitude: isAddress ? null : location.longitude,
    address: isAddress ? location : null,
    heading: null,
    signageObservation: null,
  };

  // Check if imagery exists (API accepts both address strings and lat/lng)
  const metadata = await getStreetViewMetadata(location);
  if (!metadata.available) {
    return result;
  }

  result.hasImagery = true;
  result.imageDate = metadata.date;
  result.panoramaId = metadata.panoId || null;

  // If we looked up by address, use the resolved lat/lng from the API response
  if (metadata.lat && metadata.lng) {
    result.latitude = metadata.lat;
    result.longitude = metadata.lng;
  }

  const coords = result.latitude && result.longitude
    ? { latitude: result.latitude, longitude: result.longitude }
    : null;

  // Build image URLs using panorama ID (most precise) or resolved coordinates
  result.imageUrl = buildStreetViewUrl(coords, {
    panoId: metadata.panoId || undefined,
    width: 640,
    height: 400,
  });

  result.thumbnailUrl = buildStreetViewUrl(coords, {
    panoId: metadata.panoId || undefined,
    width: 320,
    height: 200,
  });

  // Generate signage observation based on metadata
  if (metadata.date && violationDate) {
    const imageDateParts = metadata.date.split('-');
    const imageYear = parseInt(imageDateParts[0]);
    const imageMonth = parseInt(imageDateParts[1] || '1');
    const violDate = new Date(violationDate);
    const violYear = violDate.getFullYear();
    const violMonth = violDate.getMonth() + 1;

    const monthsDiff = (violYear - imageYear) * 12 + (violMonth - imageMonth);

    if (monthsDiff <= 6 && monthsDiff >= -6) {
      result.signageObservation = `Google Street View imagery from ${metadata.date} (within 6 months of the violation) is available for this location. This imagery can be used to verify signage conditions at the time of the violation.`;
    } else if (monthsDiff > 6 && monthsDiff <= 24) {
      result.signageObservation = `Google Street View imagery from ${metadata.date} (${monthsDiff} months before the violation) shows the signage conditions at this location. While not from the exact date of violation, it provides baseline evidence of posted signage.`;
    } else {
      result.signageObservation = `Google Street View imagery from ${metadata.date} is available for this location but is more than 2 years from the violation date.`;
    }
  } else if (metadata.date) {
    result.signageObservation = `Google Street View imagery from ${metadata.date} is available for this location and can be referenced for signage verification.`;
  }

  return result;
}

/**
 * Get multiple Street View angles for a location
 * Useful when looking for signage from different directions
 */
export async function getMultiAngleStreetView(
  latitude: number,
  longitude: number
): Promise<string[]> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return [];

  const coords = { latitude, longitude };
  const headings = [0, 90, 180, 270]; // N, E, S, W
  return headings
    .map(heading => buildStreetViewUrl(coords, { heading, width: 400, height: 300 }))
    .filter((url): url is string => url !== null);
}
