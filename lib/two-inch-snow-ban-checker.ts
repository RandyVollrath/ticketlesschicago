/**
 * Two-Inch Snow Ban Checker
 *
 * Checks the 2-inch snow parking ban (500 miles of main streets)
 * This is SEPARATE from the winter overnight 3am-7am ban
 *
 * - Activated ONLY when 2+ inches of snow accumulates
 * - Can be activated ANY time of day, ANY calendar date
 * - Cars may be ticketed OR relocated for snow clearing
 * - Remains active until streets are cleared
 */

import { createClient } from '@supabase/supabase-js';
import { getChicagoTime } from './chicago-timezone-utils';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export interface TwoInchSnowBanStatus {
  is_ban_active: boolean; // Is 2-inch ban currently activated?
  is_on_snow_route: boolean; // Is parked on one of the 500 miles?
  street_name: string | null;
  activation_date: string | null;
  snow_amount_inches: number | null;
  notification_type: 'forecast' | 'confirmation' | null;
  severity: 'critical' | 'warning' | 'info' | 'none';
  message: string;
}

/**
 * Check current 2-inch snow ban status
 */
export async function checkTwoInchSnowBan(): Promise<TwoInchSnowBanStatus> {
  const defaultResponse: TwoInchSnowBanStatus = {
    is_ban_active: false,
    is_on_snow_route: false,
    street_name: null,
    activation_date: null,
    snow_amount_inches: null,
    notification_type: null,
    severity: 'none',
    message: 'No 2-inch snow ban active',
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

    if (!isBanActive) {
      return defaultResponse;
    }

    // Check snow_events to determine if this is forecast vs confirmation
    let notificationType: 'forecast' | 'confirmation' | null = null;
    const chicagoTime = getChicagoTime();
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

    // Build message
    let message = '';
    let severity: 'critical' | 'warning' | 'info' | 'none' = 'info';

    if (notificationType === 'confirmation') {
      message = `2-inch snow ban ACTIVATED. ${data.snow_amount_inches}" of snow has accumulated. Cars may be ticketed or relocated for snow clearing.`;
      severity = 'critical';
    } else if (notificationType === 'forecast') {
      message = `2+ inches of snow forecasted. 2-inch parking ban may be activated if accumulation reaches 2 inches.`;
      severity = 'warning';
    } else {
      message = `2-inch snow ban is active. Cars may be ticketed or relocated for snow clearing.`;
      severity = 'warning';
    }

    return {
      is_ban_active: isBanActive,
      is_on_snow_route: false, // Will be set by checkLocationTwoInchSnowBan
      street_name: null,
      activation_date: data.activation_date,
      snow_amount_inches: data.snow_amount_inches,
      notification_type: notificationType,
      severity,
      message,
    };
  } catch (error) {
    console.error('Error checking 2-inch snow ban status:', error);
    return defaultResponse;
  }
}

/**
 * Check if a specific location is on a 2-inch snow ban route
 */
export async function checkLocationTwoInchSnowBan(
  latitude: number,
  longitude: number
): Promise<TwoInchSnowBanStatus> {
  // First check if ban is active
  const banStatus = await checkTwoInchSnowBan();

  // Then check if location is on a snow route (500 miles)
  try {
    const { data, error } = await supabase.rpc('get_snow_route_at_location_enhanced', {
      user_lat: latitude,
      user_lng: longitude,
      distance_meters: 30,
    });

    const isOnSnowRoute = !error && data && data.length > 0;
    const streetName = isOnSnowRoute ? data[0].street_name : null;

    // Update status based on location
    if (isOnSnowRoute && banStatus.is_ban_active) {
      if (banStatus.notification_type === 'confirmation') {
        banStatus.severity = 'critical';
        banStatus.message = `2-INCH SNOW BAN ACTIVATED! You parked on ${streetName}. ${banStatus.snow_amount_inches}" of snow has accumulated. Your car may be ticketed or relocated for snow clearing. Move immediately.`;
      } else if (banStatus.notification_type === 'forecast') {
        banStatus.severity = 'warning';
        banStatus.message = `2+ inches forecasted on ${streetName}. If 2-inch snow ban is activated, your car may be ticketed or relocated. Plan to move your car.`;
      } else {
        banStatus.severity = 'warning';
        banStatus.message = `You parked on ${streetName}. 2-inch snow ban is active - cars may be ticketed or relocated for snow clearing.`;
      }
    } else if (isOnSnowRoute && !banStatus.is_ban_active) {
      banStatus.severity = 'info';
      banStatus.message = `You parked on ${streetName}, a 2-inch snow ban street. Parking may be restricted when 2+ inches of snow accumulates.`;
    }

    return {
      ...banStatus,
      is_on_snow_route: isOnSnowRoute,
      street_name: streetName,
    };
  } catch (error) {
    console.error('Error checking location for 2-inch snow ban:', error);
    return {
      ...banStatus,
      is_on_snow_route: false,
      street_name: null,
    };
  }
}

/**
 * Format 2-inch snow ban message for notifications
 */
export function formatTwoInchSnowBanNotification(status: TwoInchSnowBanStatus): {
  title: string;
  body: string;
  urgent: boolean;
} {
  if (!status.is_ban_active) {
    return {
      title: 'Snow Route',
      body: status.message,
      urgent: false,
    };
  }

  if (status.severity === 'critical') {
    return {
      title: '🚨 2-INCH SNOW BAN ACTIVATED',
      body: status.message,
      urgent: true,
    };
  } else if (status.severity === 'warning') {
    return {
      title: '❄️ 2+ Inches Forecasted',
      body: status.message,
      urgent: false,
    };
  } else {
    return {
      title: 'ℹ️ Snow Route Information',
      body: status.message,
      urgent: false,
    };
  }
}
