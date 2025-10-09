/**
 * Parse Chicago street addresses into components for permit zone lookups
 *
 * Examples:
 *   "1710 S Clinton St" -> { number: 1710, direction: "S", name: "CLINTON", type: "ST" }
 *   "123 North Michigan Avenue" -> { number: 123, direction: "N", name: "MICHIGAN", type: "AVE" }
 */

export interface ParsedAddress {
  number: number;
  direction: string | null;
  name: string;
  type: string | null;
  isOdd: boolean;
  original: string;
}

// Common street type abbreviations
const STREET_TYPES: Record<string, string> = {
  'STREET': 'ST',
  'ST': 'ST',
  'AVENUE': 'AVE',
  'AVE': 'AVE',
  'BOULEVARD': 'BLVD',
  'BLVD': 'BLVD',
  'DRIVE': 'DR',
  'DR': 'DR',
  'ROAD': 'RD',
  'RD': 'RD',
  'LANE': 'LN',
  'LN': 'LN',
  'PLACE': 'PL',
  'PL': 'PL',
  'COURT': 'CT',
  'CT': 'CT',
  'PARKWAY': 'PKWY',
  'PKWY': 'PKWY',
  'TERRACE': 'TER',
  'TER': 'TER',
  'WAY': 'WAY',
};

// Direction abbreviations
const DIRECTIONS: Record<string, string> = {
  'NORTH': 'N',
  'N': 'N',
  'SOUTH': 'S',
  'S': 'S',
  'EAST': 'E',
  'E': 'E',
  'WEST': 'W',
  'W': 'W',
  'NORTHEAST': 'NE',
  'NE': 'NE',
  'NORTHWEST': 'NW',
  'NW': 'NW',
  'SOUTHEAST': 'SE',
  'SE': 'SE',
  'SOUTHWEST': 'SW',
  'SW': 'SW',
};

export function parseChicagoAddress(address: string): ParsedAddress | null {
  if (!address || typeof address !== 'string') {
    return null;
  }

  // Clean and normalize
  const cleaned = address
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/[.,#]/g, ''); // Remove punctuation

  // Split into parts
  const parts = cleaned.split(' ');

  if (parts.length < 2) {
    return null; // Not enough parts
  }

  // Extract street number (first part should be a number)
  const numberStr = parts[0];
  const number = parseInt(numberStr, 10);

  if (isNaN(number) || number <= 0) {
    return null; // Invalid street number
  }

  // Determine if address is odd or even
  const isOdd = number % 2 !== 0;

  // Remove the number from parts
  const remainingParts = parts.slice(1);

  // Try to extract direction (might be second part)
  let direction: string | null = null;
  let nameStartIndex = 0;

  if (remainingParts.length > 0 && DIRECTIONS[remainingParts[0]]) {
    direction = DIRECTIONS[remainingParts[0]];
    nameStartIndex = 1;
  }

  // Try to extract street type (usually last part)
  let type: string | null = null;
  let nameEndIndex = remainingParts.length;

  if (remainingParts.length > 0) {
    const lastPart = remainingParts[remainingParts.length - 1];
    if (STREET_TYPES[lastPart]) {
      type = STREET_TYPES[lastPart];
      nameEndIndex = remainingParts.length - 1;
    }
  }

  // Extract street name (everything between direction and type)
  const nameParts = remainingParts.slice(nameStartIndex, nameEndIndex);

  if (nameParts.length === 0) {
    return null; // No street name found
  }

  const name = nameParts.join(' ');

  return {
    number,
    direction,
    name,
    type,
    isOdd,
    original: address.trim()
  };
}

/**
 * Example usage:
 *
 * const parsed = parseChicagoAddress("1710 S Clinton St");
 * // Returns: { number: 1710, direction: "S", name: "CLINTON", type: "ST", isOdd: false }
 *
 * const parsed2 = parseChicagoAddress("123 North Michigan Avenue");
 * // Returns: { number: 123, direction: "N", name: "MICHIGAN", type: "AVE", isOdd: true }
 */
