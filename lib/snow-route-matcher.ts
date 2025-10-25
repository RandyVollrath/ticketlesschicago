/**
 * Snow Route Matcher
 *
 * Determines if a given address is on a Chicago Two-Inch Snow Ban route
 * Uses the snow_routes table with geometry data from CDOT FOIA request
 */

import { supabaseAdmin } from './supabase';

interface SnowRoute {
  id: number;
  on_street: string;
  from_street: string;
  to_street: string;
  restrict_type: string;
}

interface AddressMatchResult {
  isOnSnowRoute: boolean;
  route: SnowRoute | null;
  streetName: string | null;
}

/**
 * Extract street name from a full address
 * Examples:
 *   "1234 W 111TH ST" → "W 111TH ST"
 *   "5678 S ASHLAND AVE" → "S ASHLAND AVE"
 */
function extractStreetName(address: string): string | null {
  if (!address) return null;

  // Remove apartment/unit numbers
  const cleaned = address
    .trim()
    .toUpperCase()
    .replace(/,.*$/, '') // Remove anything after comma
    .replace(/#.*$/, '')  // Remove unit numbers
    .replace(/APT.*$/i, '')
    .replace(/UNIT.*$/i, '')
    .trim();

  // Match pattern: [number] [street name]
  // Street name can be: "W 111TH ST", "S ASHLAND AVE", etc.
  const match = cleaned.match(/^\d+\s+(.+)$/);

  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

/**
 * Check if an address is on a Two-Inch Snow Ban route
 *
 * @param address - Full street cleaning address (e.g., "1234 W 111TH ST")
 * @returns Match result with route information if found
 */
export async function isAddressOnSnowRoute(address: string): Promise<AddressMatchResult> {
  const streetName = extractStreetName(address);

  if (!streetName) {
    return {
      isOnSnowRoute: false,
      route: null,
      streetName: null
    };
  }

  try {
    // Query snow_routes for exact street name match
    const { data: routes, error } = await supabaseAdmin
      .from('snow_routes')
      .select('id, on_street, from_street, to_street, restrict_type')
      .eq('on_street', streetName)
      .limit(1);

    if (error) {
      console.error('Error querying snow routes:', error);
      throw error;
    }

    if (routes && routes.length > 0) {
      return {
        isOnSnowRoute: true,
        route: routes[0],
        streetName
      };
    }

    // Try fuzzy matching for common variations
    // Sometimes addresses use "STREET" vs "ST", "AVENUE" vs "AVE", etc.
    const fuzzyStreetName = streetName
      .replace(/\bSTREET\b/g, 'ST')
      .replace(/\bAVENUE\b/g, 'AVE')
      .replace(/\bBOULEVARD\b/g, 'BLVD')
      .replace(/\bDRIVE\b/g, 'DR')
      .replace(/\bROAD\b/g, 'RD');

    if (fuzzyStreetName !== streetName) {
      const { data: fuzzyRoutes, error: fuzzyError } = await supabaseAdmin
        .from('snow_routes')
        .select('id, on_street, from_street, to_street, restrict_type')
        .eq('on_street', fuzzyStreetName)
        .limit(1);

      if (!fuzzyError && fuzzyRoutes && fuzzyRoutes.length > 0) {
        return {
          isOnSnowRoute: true,
          route: fuzzyRoutes[0],
          streetName
        };
      }
    }

    return {
      isOnSnowRoute: false,
      route: null,
      streetName
    };

  } catch (error) {
    console.error('Error checking snow route:', error);
    throw error;
  }
}

/**
 * Get all users on snow ban routes
 * Uses street cleaning address (home_address_full) from user profiles
 *
 * @returns Array of users with their snow route information
 */
export async function getUsersOnSnowRoutes(): Promise<Array<{
  user_id: string;
  email: string;
  phone_number: string;
  first_name: string;
  home_address_full: string;
  route: SnowRoute;
  notify_snow_forecast: boolean;
  notify_snow_forecast_email: boolean;
  notify_snow_forecast_sms: boolean;
  notify_snow_confirmation: boolean;
  notify_snow_confirmation_email: boolean;
  notify_snow_confirmation_sms: boolean;
}>> {
  try {
    // Get all users with street cleaning addresses and their notification preferences
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        user_id,
        email,
        phone_number,
        first_name,
        home_address_full,
        notify_snow_forecast,
        notify_snow_forecast_email,
        notify_snow_forecast_sms,
        notify_snow_confirmation,
        notify_snow_confirmation_email,
        notify_snow_confirmation_sms
      `)
      .not('home_address_full', 'is', null);

    if (usersError) throw usersError;
    if (!users || users.length === 0) return [];

    // Check each user's address against snow routes
    const usersOnRoutes: Array<any> = [];

    for (const user of users) {
      const matchResult = await isAddressOnSnowRoute(user.home_address_full);

      if (matchResult.isOnSnowRoute && matchResult.route) {
        usersOnRoutes.push({
          ...user,
          route: matchResult.route
        });
      }
    }

    return usersOnRoutes;

  } catch (error) {
    console.error('Error getting users on snow routes:', error);
    throw error;
  }
}

/**
 * Get count of users on snow ban routes (for admin reporting)
 */
export async function getSnowRouteUserCount(): Promise<number> {
  const users = await getUsersOnSnowRoutes();
  return users.length;
}
