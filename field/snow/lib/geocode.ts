/**
 * Google Geocoding API utility
 * Converts addresses to lat/long coordinates
 */

interface GeocodeResult {
  lat: number;
  long: number;
  formattedAddress: string;
}

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }>;
}

/**
 * Geocode an address using Google Maps Geocoding API
 * Biased toward Chicago, IL for better local results
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!apiKey) {
    console.error("GOOGLE_API_KEY not configured");
    return null;
  }

  // Append Chicago, IL if not already specified for better local results
  let searchAddress = address;
  if (!address.toLowerCase().includes("chicago") && !address.toLowerCase().includes(", il")) {
    searchAddress = `${address}, Chicago, IL`;
  }

  try {
    const encodedAddress = encodeURIComponent(searchAddress);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

    const response = await fetch(url);
    const data: GoogleGeocodeResponse = await response.json();

    if (data.status !== "OK" || data.results.length === 0) {
      console.error("Geocoding failed:", data.status);
      return null;
    }

    const result = data.results[0];
    return {
      lat: result.geometry.location.lat,
      long: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
    };
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

/**
 * Calculate Haversine distance between two points (in miles)
 * Used as a fallback when DB function is not available
 */
export function haversineDistance(
  lat1: number,
  long1: number,
  lat2: number,
  long2: number
): number {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLong = toRad(long2 - long1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLong / 2) * Math.sin(dLong / 2);

  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Parse price from text message
 * Examples: "$50", "50 dollars", "up to 75", "max 100"
 */
export function parsePriceFromText(text: string): number | null {
  // Match patterns like "$50", "50 dollars", "up to 75", "max 100"
  const patterns = [
    /\$(\d+)/,
    /(\d+)\s*(?:dollars|bucks)/i,
    /(?:up\s*to|max|maximum|budget)\s*\$?(\d+)/i,
    /\$?(\d+)\s*(?:max|maximum)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const price = parseInt(match[1], 10);
      if (price > 0 && price < 10000) {
        return price;
      }
    }
  }

  return null;
}

/**
 * Parse address from text message
 * Returns the address portion of the message
 */
export function parseAddressFromText(text: string): string | null {
  // Common address patterns
  const addressPattern = /\d+\s+[\w\s]+\b(?:st|street|ave|avenue|blvd|boulevard|dr|drive|rd|road|ln|lane|ct|court|way|place|pl|cir|circle)\b/i;

  const match = text.match(addressPattern);
  if (match) {
    return match[0].trim();
  }

  // If no clear address pattern, check if the message starts with a number (likely an address)
  if (/^\d+\s+\w+/.test(text.trim())) {
    // Take everything up to a price indicator or end of line
    const addressEnd = text.search(/(?:\$\d+|\d+\s*(?:dollars|bucks)|max|budget|please|thanks)/i);
    if (addressEnd > 0) {
      return text.substring(0, addressEnd).trim();
    }
    return text.trim();
  }

  return null;
}
