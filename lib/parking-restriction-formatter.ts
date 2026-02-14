/**
 * Parking Restriction Message Formatter
 *
 * Centralizes all parking restriction message templates and formatting
 */

import type { StreetCleaningMatch } from './street-cleaning-schedule-matcher';
import type { WinterOvernightBanStatus } from './winter-overnight-ban-checker';
import type { TwoInchSnowBanStatus } from './two-inch-snow-ban-checker';
import type { PermitZoneStatus } from './permit-zone-time-validator';

export interface FormattedRestriction {
  type: 'street_cleaning' | 'winter_overnight_ban' | 'two_inch_snow_ban' | 'permit_zone';
  severity: 'critical' | 'warning' | 'info' | 'none';
  title: string;
  message: string;
  shortMessage: string; // For SMS/notifications
  actionRequired: boolean;
  timing: {
    is_now: boolean;
    is_today: boolean;
    is_tomorrow: boolean;
    hours_until: number;
    description: string;
  };
}

/**
 * Format street cleaning restriction
 */
export function formatStreetCleaningRestriction(
  match: StreetCleaningMatch
): FormattedRestriction | null {
  if (!match.found || !match.nextCleaningDate) {
    return null;
  }

  const { severity, timing, ward, section } = match;

  // Title
  let title = '';
  if (timing.is_now) {
    title = '🚨 STREET CLEANING NOW';
  } else if (timing.is_today) {
    title = '⚠️ Street Cleaning TODAY';
  } else if (timing.is_tomorrow) {
    title = '📅 Street Cleaning Tomorrow';
  } else {
    title = 'ℹ️ Street Cleaning Scheduled';
  }

  // Full message
  let message = '';
  if (timing.is_now) {
    message = `Street cleaning is happening NOW in Ward ${ward} Section ${section}. Move your car immediately to avoid a ticket!`;
  } else if (timing.is_today) {
    message = `Street cleaning starts at 9am TODAY (in ${timing.hours_until} hours) in Ward ${ward} Section ${section}. Make sure your car is moved before 9am.`;
  } else if (timing.is_tomorrow) {
    message = `Street cleaning scheduled for TOMORROW at 9am in Ward ${ward} Section ${section}. Plan to move your car before then.`;
  } else {
    message = `Street cleaning scheduled ${timing.relative_description} in Ward ${ward} Section ${section}.`;
  }

  // Short message for notifications
  let shortMessage = '';
  if (timing.is_now) {
    shortMessage = `MOVE CAR NOW! Street cleaning in progress - Ward ${ward} Section ${section}`;
  } else if (timing.is_today) {
    shortMessage = `Street cleaning TODAY 9am (${timing.hours_until}h) - Ward ${ward} Section ${section}`;
  } else if (timing.is_tomorrow) {
    shortMessage = `Street cleaning TOMORROW 9am - Ward ${ward} Section ${section}`;
  } else {
    shortMessage = `Street cleaning ${timing.relative_description}`;
  }

  return {
    type: 'street_cleaning',
    severity,
    title,
    message,
    shortMessage,
    actionRequired: timing.is_now || timing.is_today,
    timing: {
      is_now: timing.is_now,
      is_today: timing.is_today,
      is_tomorrow: timing.is_tomorrow,
      hours_until: timing.hours_until,
      description: timing.relative_description,
    },
  };
}

/**
 * Format Winter Overnight Parking Ban restriction (3am-7am, Dec 1 - April 1)
 * 107 miles of arterial streets, active every night during winter season
 */
export function formatWinterOvernightBanRestriction(
  status: WinterOvernightBanStatus
): FormattedRestriction | null {
  if (!status.is_winter_season || !status.is_on_ban_street) {
    return null;
  }

  const { severity, is_ban_hours, hours_until_ban_start, street_name } = status;
  const streetInfo = street_name ? ` on ${street_name}` : '';

  // Title
  let title = '';
  if (is_ban_hours) {
    title = '🚨 WINTER BAN ACTIVE NOW';
  } else if (hours_until_ban_start < 4) {
    title = '⚠️ Winter Ban Starting Soon';
  } else {
    title = 'ℹ️ Winter Overnight Ban Street';
  }

  // Full message
  let message = '';
  if (is_ban_hours) {
    message = `You parked${streetInfo} during winter overnight parking ban hours (3am-7am). Your car MUST be moved immediately or it will be TOWED ($150 tow + $60 ticket + $25/day storage).`;
  } else if (hours_until_ban_start < 4) {
    message = `You parked${streetInfo}. Winter overnight parking ban starts in ${hours_until_ban_start} hours (3am). Move your car before 3am to avoid being towed.`;
  } else {
    message = `You parked${streetInfo}. No parking allowed 3am-7am every night (Dec 1 - April 1) regardless of snow. Violators will be towed.`;
  }

  // Short message
  let shortMessage = '';
  if (is_ban_hours) {
    shortMessage = `MOVE CAR NOW! Winter ban 3am-7am - Will be towed${streetInfo}`;
  } else if (hours_until_ban_start < 4) {
    shortMessage = `Winter ban in ${hours_until_ban_start}h (3am) - Move now${streetInfo}`;
  } else {
    shortMessage = `Winter ban route: No parking 3am-7am${streetInfo}`;
  }

  return {
    type: 'winter_overnight_ban',
    severity,
    title,
    message,
    shortMessage,
    actionRequired: is_ban_hours || hours_until_ban_start < 4,
    timing: {
      is_now: is_ban_hours,
      is_today: hours_until_ban_start < 24,
      is_tomorrow: hours_until_ban_start >= 24 && hours_until_ban_start < 48,
      hours_until: hours_until_ban_start,
      description: is_ban_hours ? 'now' : `in ${hours_until_ban_start} hours`,
    },
  };
}

/**
 * Format 2-Inch Snow Ban restriction (500 miles, activated when 2+ inches)
 * Can be activated any time of day, any calendar date
 */
export function formatTwoInchSnowBanRestriction(
  status: TwoInchSnowBanStatus
): FormattedRestriction | null {
  if (!status.is_ban_active && !status.is_on_snow_route) {
    return null;
  }

  const { severity, notification_type, street_name } = status;
  const streetInfo = street_name ? ` on ${street_name}` : '';

  // Determine if this is forecast (predicted) or confirmation (accumulated)
  const isForecast = notification_type === 'forecast';
  const isConfirmation = notification_type === 'confirmation';

  // Title
  let title = '';
  if (isConfirmation) {
    title = '🚨 2-INCH SNOW BAN ACTIVATED';
  } else if (isForecast) {
    title = '❄️ 2+ Inches Forecasted';
  } else {
    title = 'ℹ️ 2-Inch Snow Ban Street';
  }

  // Full message
  let message = '';
  if (isConfirmation) {
    message = `2-INCH SNOW BAN ACTIVATED! 2+ inches of snow has accumulated${streetInfo}. Your car may be TICKETED or RELOCATED for snow clearing operations. Move immediately.`;
  } else if (isForecast) {
    message = `2+ inches of snow is forecasted${streetInfo}. If accumulation reaches 2 inches, parking ban may be activated and your car may be ticketed or relocated. Plan to move your car.`;
  } else {
    message = `You parked${streetInfo}, a 2-inch snow ban street. When 2+ inches accumulates, parking ban may be activated and cars may be ticketed or relocated.`;
  }

  // Short message
  let shortMessage = '';
  if (isConfirmation) {
    shortMessage = `MOVE NOW! 2" ban active - Car may be ticketed/relocated${streetInfo}`;
  } else if (isForecast) {
    shortMessage = `2" snow forecasted - Plan to move car${streetInfo}`;
  } else {
    shortMessage = `2" snow ban route${streetInfo}`;
  }

  return {
    type: 'two_inch_snow_ban',
    severity,
    title,
    message,
    shortMessage,
    actionRequired: isConfirmation,
    timing: {
      is_now: isConfirmation,
      is_today: isForecast || isConfirmation,
      is_tomorrow: false,
      hours_until: isConfirmation ? 0 : 24,
      description: isConfirmation ? 'now' : (isForecast ? 'forecasted' : 'when 2+ inches accumulates'),
    },
  };
}

/**
 * Format permit zone restriction
 */
export function formatPermitZoneRestriction(
  status: PermitZoneStatus
): FormattedRestriction | null {
  const { is_currently_restricted, severity, zone_name, hours_until_restriction } = status;

  if (severity === 'none') {
    return null;
  }

  // Title
  let title = '';
  if (is_currently_restricted) {
    title = '🅿️ Permit Required NOW';
  } else if (hours_until_restriction < 4) {
    title = '⚠️ Permit Zone Starting Soon';
  } else {
    title = 'ℹ️ Permit Parking Zone';
  }

  // Full message
  let message = '';
  if (is_currently_restricted) {
    message = `You parked in ${zone_name}. A permit may be required right now. Check posted signs.`;
  } else if (hours_until_restriction < 4) {
    message = `You parked in ${zone_name}. Permit enforcement may start soon. Check posted signs.`;
  } else {
    message = `You parked in ${zone_name}. Permit may be required. Check posted signs.`;
  }

  // Short message
  let shortMessage = '';
  if (is_currently_restricted) {
    shortMessage = `Permit may be required now - ${zone_name}`;
  } else if (hours_until_restriction < 4) {
    shortMessage = `Permit required in ${hours_until_restriction}h - ${zone_name}`;
  } else {
    shortMessage = `${zone_name} - Permit zone`;
  }

  return {
    type: 'permit_zone',
    severity,
    title,
    message,
    shortMessage,
    actionRequired: is_currently_restricted,
    timing: {
      is_now: is_currently_restricted,
      is_today: hours_until_restriction < 24,
      is_tomorrow: hours_until_restriction >= 24 && hours_until_restriction < 48,
      hours_until: hours_until_restriction,
      description: is_currently_restricted ? 'now' : `in ${hours_until_restriction} hours`,
    },
  };
}

/**
 * Format multiple restrictions into a combined message
 */
export function formatCombinedRestrictions(
  restrictions: FormattedRestriction[]
): {
  highestSeverity: 'critical' | 'warning' | 'info' | 'none';
  combinedTitle: string;
  combinedMessage: string;
  individualRestrictions: FormattedRestriction[];
} {
  if (restrictions.length === 0) {
    return {
      highestSeverity: 'none',
      combinedTitle: 'No Restrictions',
      combinedMessage: 'No parking restrictions found at this location',
      individualRestrictions: [],
    };
  }

  // Sort by severity
  const severityOrder = { critical: 0, warning: 1, info: 2, none: 3 };
  const sorted = restrictions.sort((a, b) =>
    severityOrder[a.severity] - severityOrder[b.severity]
  );

  const highestSeverity = sorted[0].severity;

  // Build combined title
  let combinedTitle = '';
  const criticalCount = restrictions.filter(r => r.severity === 'critical').length;
  const warningCount = restrictions.filter(r => r.severity === 'warning').length;

  if (criticalCount > 0) {
    combinedTitle = `🚨 ${criticalCount} URGENT Restriction${criticalCount > 1 ? 's' : ''}!`;
  } else if (warningCount > 0) {
    combinedTitle = `⚠️ ${warningCount} Parking Alert${warningCount > 1 ? 's' : ''}`;
  } else {
    combinedTitle = `ℹ️ ${restrictions.length} Restriction${restrictions.length > 1 ? 's' : ''}`;
  }

  // Build combined message
  const messages = sorted.map((r, i) => `${i + 1}. ${r.message}`).join('\n\n');
  const combinedMessage = `You have ${restrictions.length} parking restriction${restrictions.length > 1 ? 's' : ''} at this location:\n\n${messages}`;

  return {
    highestSeverity,
    combinedTitle,
    combinedMessage,
    individualRestrictions: sorted,
  };
}

/**
 * Get emoji for restriction type
 */
export function getRestrictionEmoji(type: 'street_cleaning' | 'winter_overnight_ban' | 'two_inch_snow_ban' | 'permit_zone'): string {
  switch (type) {
    case 'street_cleaning':
      return '🧹';
    case 'winter_overnight_ban':
      return '🌙';
    case 'two_inch_snow_ban':
      return '❄️';
    case 'permit_zone':
      return '🅿️';
    default:
      return 'ℹ️';
  }
}

/**
 * Get color code for severity (for UI)
 */
export function getSeverityColor(severity: 'critical' | 'warning' | 'info' | 'none'): string {
  switch (severity) {
    case 'critical':
      return '#ff4444'; // Red
    case 'warning':
      return '#ff9800'; // Orange
    case 'info':
      return '#2196f3'; // Blue
    case 'none':
      return '#4caf50'; // Green
    default:
      return '#999999'; // Gray
  }
}
