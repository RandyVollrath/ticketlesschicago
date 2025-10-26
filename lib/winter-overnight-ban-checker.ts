/**
 * Winter Overnight Parking Ban Checker
 *
 * Checks the permanent 3am-7am winter parking ban (Dec 1 - April 1)
 * This is SEPARATE from the 2-inch snow ban
 *
 * 107 miles of arterial streets
 * Active every night during winter months, regardless of snow
 */

import { createClient } from '@supabase/supabase-js';
import { getChicagoTime } from './chicago-timezone-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface WinterOvernightBanStatus {
  is_winter_season: boolean; // Dec 1 - April 1
  is_ban_hours: boolean; // Currently 3am-7am
  is_on_ban_street: boolean; // Parked on one of the 107 miles
  street_name: string | null;
  severity: 'critical' | 'warning' | 'info' | 'none';
  hours_until_ban_start: number;
  hours_until_ban_end: number;
  timing: {
    current_hour_chicago: number;
    next_ban_start: string; // ISO timestamp
    ban_ends: string | null; // ISO timestamp
    season_start: string; // December 1
    season_end: string; // April 1
  };
}

/**
 * Check if current date is within winter ban season (Dec 1 - April 1)
 */
function isWinterBanSeason(): boolean {
  const now = getChicagoTime();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();

  // Dec 1 - April 1
  // December = 11, January = 0, February = 1, March = 2, April = 3
  if (month === 11) {
    // December - active from Dec 1 onwards
    return day >= 1;
  } else if (month >= 0 && month <= 2) {
    // January, February, March - always active
    return true;
  } else if (month === 3) {
    // April - only active until April 1
    return day === 1;
  }

  return false;
}

/**
 * Check if current time is within ban hours (3am-7am Chicago time)
 */
function isWithinBanHours(): boolean {
  const now = getChicagoTime();
  const hour = now.getHours();
  return hour >= 3 && hour < 7;
}

/**
 * Calculate hours until next 3am
 */
function hoursUntilNextBan(): number {
  const now = getChicagoTime();
  const currentHour = now.getHours();

  if (currentHour < 3) {
    // Before 3am today
    return 3 - currentHour;
  } else if (currentHour >= 7) {
    // After 7am, next ban is tomorrow at 3am
    return 24 - currentHour + 3;
  } else {
    // Currently in ban hours (3am-7am)
    return 0;
  }
}

/**
 * Calculate hours until ban ends (7am)
 */
function hoursUntilBanEnds(): number {
  const now = getChicagoTime();
  const currentHour = now.getHours();

  if (currentHour >= 3 && currentHour < 7) {
    // Currently in ban hours
    return 7 - currentHour;
  }
  return 0; // Not currently in ban hours
}

/**
 * Check if location is on a winter overnight ban street
 */
export async function checkWinterOvernightBan(
  latitude: number,
  longitude: number
): Promise<WinterOvernightBanStatus> {
  const chicagoTime = getChicagoTime();
  const isWinterSeason = isWinterBanSeason();
  const isBanHours = isWithinBanHours();
  const hoursUntilBan = hoursUntilNextBan();
  const hoursUntilEnd = hoursUntilBanEnds();

  // Calculate season dates
  const currentYear = chicagoTime.getFullYear();
  const seasonStart = isWinterSeason && chicagoTime.getMonth() < 11
    ? new Date(currentYear - 1, 11, 1) // Last December
    : new Date(currentYear, 11, 1); // This December
  const seasonEnd = new Date(seasonStart.getFullYear() + 1, 3, 1); // Next April 1

  // Calculate next ban start time (next 3am)
  const nextBanStart = new Date(chicagoTime);
  const currentHour = chicagoTime.getHours();
  if (currentHour >= 3 && currentHour < 7) {
    // Currently in ban hours, next start is tomorrow at 3am
    nextBanStart.setDate(nextBanStart.getDate() + 1);
    nextBanStart.setHours(3, 0, 0, 0);
  } else if (currentHour < 3) {
    // Before 3am today
    nextBanStart.setHours(3, 0, 0, 0);
  } else {
    // After 7am, next ban is tomorrow at 3am
    nextBanStart.setDate(nextBanStart.getDate() + 1);
    nextBanStart.setHours(3, 0, 0, 0);
  }

  // Calculate ban end time (7am)
  let banEnds: Date | null = null;
  if (isBanHours) {
    banEnds = new Date(chicagoTime);
    banEnds.setHours(7, 0, 0, 0);
  } else if (isWinterSeason) {
    // Next ban ends tomorrow at 7am
    banEnds = new Date(nextBanStart);
    banEnds.setHours(7, 0, 0, 0);
  }

  const defaultResponse: WinterOvernightBanStatus = {
    is_winter_season: isWinterSeason,
    is_ban_hours: isBanHours,
    is_on_ban_street: false,
    street_name: null,
    severity: 'none',
    hours_until_ban_start: hoursUntilBan,
    hours_until_ban_end: hoursUntilEnd,
    timing: {
      current_hour_chicago: currentHour,
      next_ban_start: nextBanStart.toISOString(),
      ban_ends: banEnds ? banEnds.toISOString() : null,
      season_start: seasonStart.toISOString(),
      season_end: seasonEnd.toISOString(),
    },
  };

  // If not winter season, return early
  if (!isWinterSeason) {
    return defaultResponse;
  }

  try {
    // Check if location is on a winter overnight ban street
    // Note: We need spatial data for these streets. For now, use address matching.
    // TODO: Add geometry data to winter_overnight_parking_ban_streets table

    // Query winter ban streets within 30 meters of location
    const { data, error } = await supabase
      .from('winter_overnight_parking_ban_streets')
      .select('*');

    if (error) {
      console.warn('Could not fetch winter ban streets:', error);
      return defaultResponse;
    }

    // For now, we can't do spatial queries without geometry
    // This will need to be enhanced when geometry is added
    // Returning default for now
    const isOnBanStreet = false; // TODO: Implement spatial query
    const streetName = null;

    // Determine severity
    let severity: 'critical' | 'warning' | 'info' | 'none' = 'none';
    if (isOnBanStreet && isBanHours) {
      severity = 'critical'; // On ban street during ban hours
    } else if (isOnBanStreet && hoursUntilBan < 4) {
      severity = 'warning'; // On ban street, ban starting soon
    } else if (isOnBanStreet) {
      severity = 'info'; // On ban street but not during ban hours
    }

    return {
      ...defaultResponse,
      is_on_ban_street: isOnBanStreet,
      street_name: streetName,
      severity,
    };
  } catch (error) {
    console.error('Error checking winter overnight ban:', error);
    return defaultResponse;
  }
}

/**
 * Format winter overnight ban message for notifications
 */
export function formatWinterOvernightBanNotification(status: WinterOvernightBanStatus): {
  title: string;
  body: string;
  urgent: boolean;
} {
  if (!status.is_winter_season) {
    return {
      title: 'No Winter Parking Ban',
      body: 'Winter overnight parking ban is not currently active (Dec 1 - April 1)',
      urgent: false,
    };
  }

  if (status.severity === 'critical') {
    return {
      title: '🚨 WINTER BAN ACTIVE NOW',
      body: `You parked on ${status.street_name} during winter ban hours (3am-7am). Move car immediately or will be towed ($150 tow + $60 ticket + $25/day storage).`,
      urgent: true,
    };
  } else if (status.severity === 'warning') {
    return {
      title: '⚠️ Winter Ban Starting Soon',
      body: `You parked on ${status.street_name}. Winter overnight ban starts in ${status.hours_until_ban_start} hours (3am). Move car before 3am.`,
      urgent: false,
    };
  } else if (status.severity === 'info') {
    return {
      title: 'ℹ️ Winter Overnight Ban Street',
      body: `You parked on ${status.street_name}. No parking allowed 3am-7am every night (Dec 1 - April 1).`,
      urgent: false,
    };
  }

  return {
    title: 'Winter Season Active',
    body: 'Winter overnight parking ban in effect Dec 1 - April 1 on designated streets.',
    urgent: false,
  };
}
