/**
 * Winter Overnight Parking Ban Matcher
 *
 * Determines if a given address is on a Chicago Winter Overnight Parking Ban street
 * These streets have parking banned 3am-7am every night from December 1 - April 1
 */

import { supabaseAdmin } from './supabase';

interface WinterBanStreet {
  id: number;
  street_name: string;
  from_location: string;
  to_location: string;
}

interface AddressMatchResult {
  isOnWinterBan: boolean;
  street: WinterBanStreet | null;
  streetName: string | null;
}

/**
 * Extract street name from a full address
 * Examples:
 *   "1234 W MADISON AVE" → "W MADISON AVE"
 *   "5678 S STATE ST" → "S STATE ST"
 */
function extractStreetName(address: string): string | null {
  if (!address) return null;

  const cleaned = address
    .trim()
    .toUpperCase()
    .replace(/,.*$/, '') // Remove anything after comma
    .replace(/#.*$/, '')  // Remove unit numbers
    .replace(/APT.*$/i, '')
    .replace(/UNIT.*$/i, '')
    .trim();

  // Match pattern: [number] [street name]
  const match = cleaned.match(/^\d+\s+(.+)$/);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Normalize street name for matching
 * Handles common variations like STREET vs ST, AVENUE vs AVE
 */
function normalizeStreetName(name: string): string {
  return name
    .toUpperCase()
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bPARKWAY\b/g, 'PKWY')
    .replace(/\bPLAZA\b/g, 'PLZ')
    .trim();
}

/**
 * Check if an address is on a Winter Overnight Parking Ban street
 *
 * @param address - Full street cleaning address (e.g., "1234 W MADISON AVE")
 * @returns Match result with street information if found
 */
export async function isAddressOnWinterBan(address: string): Promise<AddressMatchResult> {
  const streetName = extractStreetName(address);

  if (!streetName) {
    return {
      isOnWinterBan: false,
      street: null,
      streetName: null
    };
  }

  try {
    // Get all winter ban streets
    const { data: streets, error } = await supabaseAdmin
      .from('winter_overnight_parking_ban_streets')
      .select('id, street_name, from_location, to_location');

    if (error) {
      console.error('Error querying winter ban streets:', error);
      throw error;
    }

    if (!streets || streets.length === 0) {
      return {
        isOnWinterBan: false,
        street: null,
        streetName
      };
    }

    // Normalize the extracted street name for matching
    const normalizedAddress = normalizeStreetName(streetName);

    // Check for matches
    for (const street of streets) {
      const normalizedBanStreet = normalizeStreetName(street.street_name);

      // Check if the address street contains the ban street name
      // e.g., "W MADISON AVE" contains "MADISON AVE"
      if (normalizedAddress.includes(normalizedBanStreet) ||
          normalizedBanStreet.includes(normalizedAddress)) {
        return {
          isOnWinterBan: true,
          street: street,
          streetName
        };
      }
    }

    return {
      isOnWinterBan: false,
      street: null,
      streetName
    };

  } catch (error) {
    console.error('Error checking winter ban:', error);
    throw error;
  }
}

/**
 * Get all users on winter ban streets
 * Uses street cleaning address (home_address_full) from user profiles
 *
 * @returns Array of users with their winter ban street information
 */
export async function getUsersOnWinterBanStreets(): Promise<Array<{
  user_id: string;
  email: string;
  phone_number: string;
  first_name: string;
  home_address_full: string;
  street: WinterBanStreet;
}>> {
  try {
    // Get all users with street cleaning addresses
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone_number, first_name, home_address_full')
      .not('home_address_full', 'is', null);

    if (usersError) throw usersError;
    if (!users || users.length === 0) return [];

    // Check each user's address against winter ban streets
    const usersOnStreets: Array<any> = [];

    for (const user of users) {
      const matchResult = await isAddressOnWinterBan(user.home_address_full);

      if (matchResult.isOnWinterBan && matchResult.street) {
        usersOnStreets.push({
          ...user,
          street: matchResult.street
        });
      }
    }

    return usersOnStreets;

  } catch (error) {
    console.error('Error getting users on winter ban streets:', error);
    throw error;
  }
}

/**
 * Get count of users on winter ban streets (for admin reporting)
 */
export async function getWinterBanUserCount(): Promise<number> {
  const users = await getUsersOnWinterBanStreets();
  return users.length;
}
