/**
 * Street Cleaning Schedule Matcher
 *
 * Matches GPS coordinates to street cleaning ward/section and determines timing.
 * Uses the main Supabase database which contains both the PostGIS ward/section
 * geometry data and the 2026 street cleaning schedule.
 */

import { supabase } from './supabase';
import {
  getChicagoDateISO,
  isToday,
  isTomorrow,
  daysUntil,
  hoursUntil,
  formatRelativeTime,
} from './chicago-timezone-utils';

export interface StreetCleaningMatch {
  found: boolean;
  ward: string | null;
  section: string | null;
  nextCleaningDate: string | null; // ISO date string
  timing: {
    is_now: boolean;
    is_today: boolean;
    is_tomorrow: boolean;
    is_this_week: boolean;
    days_until: number;
    hours_until: number;
    relative_description: string;
  };
  severity: 'critical' | 'warning' | 'info' | 'none';
  message: string;
}

/**
 * Match GPS coordinates to street cleaning ward/section and get next cleaning date
 */
export async function matchStreetCleaningSchedule(
  latitude: number,
  longitude: number
): Promise<StreetCleaningMatch> {
  const defaultResponse: StreetCleaningMatch = {
    found: false,
    ward: null,
    section: null,
    nextCleaningDate: null,
    timing: {
      is_now: false,
      is_today: false,
      is_tomorrow: false,
      is_this_week: false,
      days_until: 999,
      hours_until: 999,
      relative_description: 'no upcoming cleaning',
    },
    severity: 'none',
    message: 'No street cleaning restrictions found',
  };

  try {
    // Find ward/section using PostGIS point-in-polygon lookup
    const { data: zoneData, error: zoneError } = await supabase.rpc(
      'find_section_for_point' as any,
      {
        lon: longitude,
        lat: latitude,
      }
    ) as { data: { ward: string; section: string }[] | null; error: any };

    if (zoneError || !zoneData || zoneData.length === 0) {
      console.log('No street cleaning zone found at location:', { latitude, longitude });
      return defaultResponse;
    }

    const zone = zoneData[0];
    const { ward, section } = zone;

    if (!ward || !section) {
      return defaultResponse;
    }

    // Get next cleaning date for this ward/section
    const todayISO = getChicagoDateISO();

    const { data: scheduleData, error: scheduleError } = await supabase
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', ward)
      .eq('section', section)
      .gte('cleaning_date', todayISO)
      .order('cleaning_date', { ascending: true })
      .limit(1);

    if (scheduleError || !scheduleData || scheduleData.length === 0) {
      console.log('No upcoming cleaning found for ward/section:', { ward, section });
      return {
        ...defaultResponse,
        found: true,
        ward,
        section,
        message: `Ward ${ward} Section ${section} - No upcoming cleaning scheduled`,
      };
    }

    const nextCleaning = scheduleData[0];
    const cleaningDate = new Date(nextCleaning.cleaning_date + 'T09:00:00'); // Assume 9am start time

    // Calculate timing
    const days = daysUntil(nextCleaning.cleaning_date);
    const hours = hoursUntil(cleaningDate);

    const timing = {
      is_now: isToday(nextCleaning.cleaning_date) && hours <= 4, // Within 4 hours
      is_today: isToday(nextCleaning.cleaning_date),
      is_tomorrow: isTomorrow(nextCleaning.cleaning_date),
      is_this_week: days <= 7,
      days_until: days,
      hours_until: hours,
      relative_description: formatRelativeTime(cleaningDate, true),
    };

    // Determine severity
    let severity: 'critical' | 'warning' | 'info' | 'none' = 'none';
    if (timing.is_now) {
      severity = 'critical';
    } else if (timing.is_today) {
      severity = 'warning';
    } else if (timing.is_tomorrow || timing.is_this_week) {
      severity = 'info';
    }

    // Build message
    let message = '';
    if (timing.is_now) {
      message = `🚨 STREET CLEANING NOW! Ward ${ward} Section ${section}`;
    } else if (timing.is_today) {
      message = `⚠️ Street cleaning TODAY at 9am (${timing.hours_until} hours) - Ward ${ward} Section ${section}`;
    } else if (timing.is_tomorrow) {
      message = `📅 Street cleaning TOMORROW at 9am - Ward ${ward} Section ${section}`;
    } else {
      message = `Street cleaning ${timing.relative_description} - Ward ${ward} Section ${section}`;
    }

    return {
      found: true,
      ward,
      section,
      nextCleaningDate: nextCleaning.cleaning_date,
      timing,
      severity,
      message,
    };
  } catch (error) {
    console.error('Error matching street cleaning schedule:', error);
    return defaultResponse;
  }
}

/**
 * Get street cleaning status by ward and section
 * (Useful if you already know the ward/section from user profile)
 */
export async function getStreetCleaningByWardSection(
  ward: string,
  section: string
): Promise<StreetCleaningMatch> {
  const defaultResponse: StreetCleaningMatch = {
    found: false,
    ward,
    section,
    nextCleaningDate: null,
    timing: {
      is_now: false,
      is_today: false,
      is_tomorrow: false,
      is_this_week: false,
      days_until: 999,
      hours_until: 999,
      relative_description: 'no upcoming cleaning',
    },
    severity: 'none',
    message: 'No street cleaning restrictions found',
  };

  try {
    const todayISO = getChicagoDateISO();

    const { data: scheduleData, error } = await supabase
      .from('street_cleaning_schedule')
      .select('cleaning_date')
      .eq('ward', ward)
      .eq('section', section)
      .gte('cleaning_date', todayISO)
      .order('cleaning_date', { ascending: true })
      .limit(1);

    if (error || !scheduleData || scheduleData.length === 0) {
      return defaultResponse;
    }

    const nextCleaning = scheduleData[0];
    const cleaningDate = new Date(nextCleaning.cleaning_date + 'T09:00:00');

    const days = daysUntil(nextCleaning.cleaning_date);
    const hours = hoursUntil(cleaningDate);

    const timing = {
      is_now: isToday(nextCleaning.cleaning_date) && hours <= 4,
      is_today: isToday(nextCleaning.cleaning_date),
      is_tomorrow: isTomorrow(nextCleaning.cleaning_date),
      is_this_week: days <= 7,
      days_until: days,
      hours_until: hours,
      relative_description: formatRelativeTime(cleaningDate, true),
    };

    let severity: 'critical' | 'warning' | 'info' | 'none' = 'none';
    if (timing.is_now) severity = 'critical';
    else if (timing.is_today) severity = 'warning';
    else if (timing.is_tomorrow || timing.is_this_week) severity = 'info';

    let message = '';
    if (timing.is_now) {
      message = `🚨 STREET CLEANING NOW! Ward ${ward} Section ${section}`;
    } else if (timing.is_today) {
      message = `⚠️ Street cleaning TODAY at 9am (${timing.hours_until} hours)`;
    } else if (timing.is_tomorrow) {
      message = `📅 Street cleaning TOMORROW at 9am`;
    } else {
      message = `Street cleaning ${timing.relative_description}`;
    }

    return {
      found: true,
      ward,
      section,
      nextCleaningDate: nextCleaning.cleaning_date,
      timing,
      severity,
      message,
    };
  } catch (error) {
    console.error('Error getting street cleaning by ward/section:', error);
    return defaultResponse;
  }
}
