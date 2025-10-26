/**
 * Winter Ban Time Checker
 *
 * Checks if 2-inch snow ban is active and calculates 3am-7am restriction timing
 */

import { createClient } from '@supabase/supabase-js';
import {
  getChicagoTime,
  isWinterBanHours,
  hoursUntilWinterBan,
  formatRelativeTime,
} from './chicago-timezone-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface SnowBanStatus {
  is_ban_active: boolean;
  is_winter_ban_hours: boolean; // Currently 3am-7am
  activation_date: string | null;
  snow_amount_inches: number | null;
  severity: 'critical' | 'warning' | 'info' | 'none';
  hours_until_winter_ban: number;
  message: string;
  notification_type: 'forecast' | 'confirmation' | null; // Forecast vs actual accumulation
  timing: {
    current_hour_chicago: number;
    next_ban_start: string; // ISO timestamp
    ban_ends: string | null; // ISO timestamp
  };
}

/**
 * Check current snow ban status and timing
 */
export async function checkSnowBanStatus(): Promise<SnowBanStatus> {
  const defaultResponse: SnowBanStatus = {
    is_ban_active: false,
    is_winter_ban_hours: false,
    activation_date: null,
    snow_amount_inches: null,
    severity: 'none',
    hours_until_winter_ban: 0,
    message: 'No snow ban active',
    notification_type: null,
    timing: {
      current_hour_chicago: getChicagoTime().getHours(),
      next_ban_start: '',
      ban_ends: null,
    },
  };

  try {
    // Get snow ban status from database
    const { data, error } = await supabase
      .from('snow_route_status')
      .select('*')
      .eq('id', 1)
      .single();

    if (error || !data) {
      console.warn('Could not fetch snow ban status:', error);
      return defaultResponse;
    }

    const isBanActive = data.is_active || false;
    const isCurrentlyWinterBanHours = isWinterBanHours();
    const hoursUntilBan = hoursUntilWinterBan();

    const chicagoTime = getChicagoTime();
    const currentHour = chicagoTime.getHours();

    // Check snow_events to determine if this is forecast vs confirmation
    let notificationType: 'forecast' | 'confirmation' | null = null;
    if (isBanActive) {
      const today = chicagoTime.toISOString().split('T')[0];
      const { data: snowEvent } = await supabase
        .from('snow_events')
        .select('*')
        .eq('event_date', today)
        .eq('is_active', true)
        .single();

      if (snowEvent) {
        // If two_inch_ban_triggered is true, it's confirmation (snow has accumulated)
        // If only forecast_sent is true, it's forecast (snow is predicted)
        if (snowEvent.two_inch_ban_triggered) {
          notificationType = 'confirmation';
        } else if (snowEvent.forecast_sent) {
          notificationType = 'forecast';
        } else {
          // Default to forecast if neither flag is set yet
          notificationType = 'forecast';
        }
      }
    }

    // Calculate next ban start time (next 3am)
    const nextBanStart = new Date(chicagoTime);
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
    if (isBanActive) {
      if (isCurrentlyWinterBanHours) {
        // Ban ends at 7am today
        banEnds = new Date(chicagoTime);
        banEnds.setHours(7, 0, 0, 0);
      } else {
        // Ban ends at 7am tomorrow
        banEnds = new Date(nextBanStart);
        banEnds.setHours(7, 0, 0, 0);
      }
    }

    // Determine severity
    let severity: 'critical' | 'warning' | 'info' | 'none' = 'none';
    if (isBanActive && isCurrentlyWinterBanHours) {
      severity = 'critical'; // Ban active RIGHT NOW
    } else if (isBanActive && !isCurrentlyWinterBanHours) {
      severity = 'warning'; // Ban active but not currently 3am-7am
    } else {
      severity = 'none';
    }

    // Build message
    let message = '';
    if (isBanActive && isCurrentlyWinterBanHours) {
      const hoursUntil7am = 7 - currentHour;
      message = `🚨 2-INCH SNOW BAN ACTIVE NOW! No parking until 7am (${hoursUntil7am} hours)`;
    } else if (isBanActive && hoursUntilBan < 12) {
      message = `❄️ Snow ban active - No parking 3am-7am (${hoursUntilBan} hours until ban)`;
    } else if (isBanActive) {
      message = `❄️ 2-inch snow ban in effect - No parking 3am-7am`;
    } else {
      message = 'No snow ban active';
    }

    return {
      is_ban_active: isBanActive,
      is_winter_ban_hours: isCurrentlyWinterBanHours,
      activation_date: data.activation_date,
      snow_amount_inches: data.snow_amount_inches,
      severity,
      hours_until_winter_ban: hoursUntilBan,
      message,
      notification_type: notificationType,
      timing: {
        current_hour_chicago: currentHour,
        next_ban_start: nextBanStart.toISOString(),
        ban_ends: banEnds ? banEnds.toISOString() : null,
      },
    };
  } catch (error) {
    console.error('Error checking snow ban status:', error);
    return defaultResponse;
  }
}

/**
 * Check if a specific location is on a snow route AND if ban is active
 */
export async function checkLocationSnowBan(
  latitude: number,
  longitude: number
): Promise<SnowBanStatus & { is_on_snow_route: boolean; street_name: string | null }> {
  // First check if ban is active
  const banStatus = await checkSnowBanStatus();

  // Then check if location is on a snow route
  try {
    const { data, error } = await supabase.rpc('get_snow_route_at_location_enhanced', {
      user_lat: latitude,
      user_lng: longitude,
      distance_meters: 30,
    });

    const isOnSnowRoute = !error && data && data.length > 0;
    const streetName = isOnSnowRoute ? data[0].street_name : null;

    // If on snow route and ban active, escalate severity
    if (isOnSnowRoute && banStatus.is_ban_active) {
      if (banStatus.is_winter_ban_hours) {
        banStatus.severity = 'critical';
        banStatus.message = `🚨 MOVE YOUR CAR! You're on a snow route (${streetName}) during winter ban hours (3am-7am)`;
      } else {
        banStatus.severity = 'warning';
        banStatus.message = `❄️ You're on a snow route (${streetName}). No parking 3am-7am (${banStatus.hours_until_winter_ban} hours)`;
      }
    } else if (isOnSnowRoute && !banStatus.is_ban_active) {
      banStatus.severity = 'info';
      banStatus.message = `ℹ️ You're on a snow route (${streetName}). Parking restricted during 2-inch snow bans.`;
    }

    return {
      ...banStatus,
      is_on_snow_route: isOnSnowRoute,
      street_name: streetName,
    };
  } catch (error) {
    console.error('Error checking location snow ban:', error);
    return {
      ...banStatus,
      is_on_snow_route: false,
      street_name: null,
    };
  }
}

/**
 * Format snow ban message for notifications
 */
export function formatSnowBanNotification(status: SnowBanStatus): {
  title: string;
  body: string;
  urgent: boolean;
} {
  if (status.severity === 'critical') {
    return {
      title: '🚨 SNOW BAN ACTIVE NOW',
      body: status.message,
      urgent: true,
    };
  } else if (status.severity === 'warning') {
    return {
      title: '❄️ Snow Ban Alert',
      body: status.message,
      urgent: false,
    };
  } else {
    return {
      title: 'Snow Route Information',
      body: status.message,
      urgent: false,
    };
  }
}
