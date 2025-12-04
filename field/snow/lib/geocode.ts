/**
 * Google Geocoding API utility
 * Converts addresses to lat/long coordinates
 */

interface GeocodeResult {
  lat: number;
  long: number;
  formattedAddress: string;
  neighborhood: string | null;
}

interface AddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

interface GoogleGeocodeResponse {
  status: string;
  results: Array<{
    formatted_address: string;
    address_components: AddressComponent[];
    geometry: {
      location: {
        lat: number;
        lng: number;
      };
    };
  }>;
}

// Chicago neighborhoods and suburbs for detection
const CHICAGO_NEIGHBORHOODS = [
  // City neighborhoods
  "Lincoln Park", "Lakeview", "Wicker Park", "Bucktown", "Logan Square",
  "Wrigleyville", "Andersonville", "Edgewater", "Rogers Park", "Uptown",
  "Ravenswood", "North Center", "Albany Park", "Irving Park", "Portage Park",
  "Jefferson Park", "Edison Park", "Norwood Park", "O'Hare", "Dunning",
  "Belmont Cragin", "Hermosa", "Humboldt Park", "West Town", "Ukrainian Village",
  "East Village", "River North", "Streeterville", "Gold Coast", "Old Town",
  "Near North Side", "Near West Side", "West Loop", "Fulton Market", "Pilsen",
  "Little Village", "Bridgeport", "Bronzeville", "Hyde Park", "Kenwood",
  "South Shore", "Chatham", "Beverly", "Morgan Park", "Mount Greenwood",
  "Garfield Ridge", "Clearing", "Archer Heights", "Brighton Park", "McKinley Park",
  "Back of the Yards", "Englewood", "Auburn Gresham", "Roseland", "Pullman",
  // Suburbs
  "Evanston", "Skokie", "Wilmette", "Winnetka", "Glencoe", "Highland Park",
  "Lake Forest", "Northbrook", "Glenview", "Morton Grove", "Niles", "Park Ridge",
  "Des Plaines", "Mount Prospect", "Arlington Heights", "Palatine", "Schaumburg",
  "Hoffman Estates", "Elk Grove Village", "Rolling Meadows", "Buffalo Grove",
  "Wheeling", "Deerfield", "Libertyville", "Vernon Hills", "Mundelein",
  "Oak Park", "Forest Park", "River Forest", "Elmwood Park", "Melrose Park",
  "Maywood", "Berwyn", "Cicero", "Oak Lawn", "Orland Park", "Tinley Park",
  "Palos Heights", "Palos Hills", "Homer Glen", "Lemont", "Bolingbrook",
  "Naperville", "Aurora", "Wheaton", "Glen Ellyn", "Lombard", "Downers Grove",
  "Westmont", "Clarendon Hills", "Hinsdale", "Western Springs", "La Grange",
  "Brookfield", "Riverside", "North Riverside", "Summit", "Bedford Park",
  "Burbank", "Evergreen Park", "Chicago Heights", "Calumet City", "Harvey",
  "Dolton", "South Holland", "Lansing", "Homewood", "Flossmoor", "Olympia Fields",
];

/**
 * Extract neighborhood from address components or formatted address
 */
function extractNeighborhood(
  addressComponents: AddressComponent[],
  formattedAddress: string
): string | null {
  // First try to find neighborhood from address components
  for (const component of addressComponents) {
    if (
      component.types.includes("neighborhood") ||
      component.types.includes("sublocality") ||
      component.types.includes("sublocality_level_1")
    ) {
      // Check if it matches our known neighborhoods
      const match = CHICAGO_NEIGHBORHOODS.find(
        (n) => n.toLowerCase() === component.long_name.toLowerCase()
      );
      if (match) return match;
    }

    // Check locality (for suburbs)
    if (component.types.includes("locality")) {
      const match = CHICAGO_NEIGHBORHOODS.find(
        (n) => n.toLowerCase() === component.long_name.toLowerCase()
      );
      if (match) return match;
    }
  }

  // Fallback: search formatted address for known neighborhoods
  const lowerAddress = formattedAddress.toLowerCase();
  for (const neighborhood of CHICAGO_NEIGHBORHOODS) {
    if (lowerAddress.includes(neighborhood.toLowerCase())) {
      return neighborhood;
    }
  }

  return null;
}

export { CHICAGO_NEIGHBORHOODS };

/**
 * Geocode an address using Google Maps Geocoding API
 * Biased toward Chicago, IL for better local results
 * Returns lat/long, formatted address, and detected neighborhood
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
    const neighborhood = extractNeighborhood(
      result.address_components,
      result.formatted_address
    );

    return {
      lat: result.geometry.location.lat,
      long: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      neighborhood,
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
