/**
 * Permit Zone Time Validator
 *
 * Validates permit parking restrictions based on time of day and day of week
 * Parses restriction schedules like "Mon-Fri 8am-6pm"
 */

import {
  getChicagoTime,
  getChicagoDayOfWeek,
  getChicagoHour,
  parseTimeToHours,
  formatTimeRange,
  hoursUntil,
} from './chicago-timezone-utils';

export interface PermitRestriction {
  days: number[]; // 0=Sunday, 1=Monday, etc.
  startHour: number; // 0-23
  endHour: number; // 0-23
  description: string;
}

export interface PermitZoneStatus {
  zone_name: string;
  is_currently_restricted: boolean;
  restriction_schedule: string;
  current_status_message: string;
  next_restriction_start: Date | null;
  next_restriction_end: Date | null;
  hours_until_restriction: number;
  severity: 'critical' | 'warning' | 'info' | 'none';
}

/**
 * Parse permit zone restriction string
 * Examples:
 *   - "Mon-Fri 8am-6pm"
 *   - "Mon-Sun 6pm-6am" (overnight)
 *   - "24/7"
 *   - "Mon-Fri 9am-5pm, Sat 9am-12pm"
 */
export function parsePermitRestriction(restrictionStr: string): PermitRestriction[] {
  if (!restrictionStr) return [];

  const restrictions: PermitRestriction[] = [];

  // Handle 24/7
  if (restrictionStr.toLowerCase().includes('24/7') || restrictionStr.toLowerCase().includes('24 hours')) {
    return [{
      days: [0, 1, 2, 3, 4, 5, 6],
      startHour: 0,
      endHour: 24,
      description: '24/7',
    }];
  }

  // Split by comma for multiple restrictions
  const parts = restrictionStr.split(',').map(s => s.trim());

  for (const part of parts) {
    // Match pattern: "Mon-Fri 8am-6pm" or "Mon 8am-6pm"
    const match = part.match(/([A-Za-z\-]+)\s+(\d+(?::\d+)?\s*[ap]m)\s*-\s*(\d+(?::\d+)?\s*[ap]m)/i);

    if (match) {
      const daysPart = match[1];
      const startTime = match[2];
      const endTime = match[3];

      const days = parseDayRange(daysPart);
      const startHour = Math.floor(parseTimeToHours(startTime));
      const endHour = Math.floor(parseTimeToHours(endTime));

      restrictions.push({
        days,
        startHour,
        endHour,
        description: part,
      });
    }
  }

  // Default if no restrictions parsed
  if (restrictions.length === 0) {
    // Assume Mon-Fri 8am-6pm as default Chicago permit zone hours
    restrictions.push({
      days: [1, 2, 3, 4, 5], // Mon-Fri
      startHour: 8,
      endHour: 18,
      description: 'Mon-Fri 8am-6pm (default)',
    });
  }

  return restrictions;
}

/**
 * Parse day range string to array of day numbers
 * Examples: "Mon-Fri" => [1,2,3,4,5], "Sat" => [6], "Mon-Sun" => [0,1,2,3,4,5,6]
 */
function parseDayRange(dayStr: string): number[] {
  const dayMap: { [key: string]: number } = {
    'sun': 0, 'sunday': 0,
    'mon': 1, 'monday': 1,
    'tue': 2, 'tuesday': 2,
    'wed': 3, 'wednesday': 3,
    'thu': 4, 'thursday': 4,
    'fri': 5, 'friday': 5,
    'sat': 6, 'saturday': 6,
  };

  dayStr = dayStr.toLowerCase().trim();

  // Check for range (e.g., "mon-fri")
  if (dayStr.includes('-')) {
    const [start, end] = dayStr.split('-').map(s => s.trim());
    const startDay = dayMap[start];
    const endDay = dayMap[end];

    if (startDay === undefined || endDay === undefined) {
      return [1, 2, 3, 4, 5]; // Default to Mon-Fri
    }

    const days: number[] = [];
    if (startDay <= endDay) {
      for (let i = startDay; i <= endDay; i++) {
        days.push(i);
      }
    } else {
      // Wrap around (e.g., Fri-Mon)
      for (let i = startDay; i <= 6; i++) days.push(i);
      for (let i = 0; i <= endDay; i++) days.push(i);
    }
    return days;
  }

  // Single day
  const day = dayMap[dayStr];
  return day !== undefined ? [day] : [1, 2, 3, 4, 5]; // Default to Mon-Fri
}

/**
 * Check if current time falls within a restriction
 */
function isCurrentlyRestricted(restriction: PermitRestriction): boolean {
  const currentDay = getChicagoDayOfWeek();
  const currentHour = getChicagoHour();

  // Check if today is a restricted day
  if (!restriction.days.includes(currentDay)) {
    return false;
  }

  // Check if current hour is within restriction hours
  const { startHour, endHour } = restriction;

  if (startHour < endHour) {
    // Normal range (e.g., 8am-6pm)
    return currentHour >= startHour && currentHour < endHour;
  } else {
    // Overnight range (e.g., 6pm-6am)
    return currentHour >= startHour || currentHour < endHour;
  }
}

/**
 * Calculate next restriction start time
 */
function getNextRestrictionStart(restriction: PermitRestriction): Date | null {
  const chicagoTime = getChicagoTime();
  const currentDay = getChicagoDayOfWeek();
  const currentHour = getChicagoHour();

  // Find next occurrence of this restriction
  for (let daysAhead = 0; daysAhead < 7; daysAhead++) {
    const checkDay = (currentDay + daysAhead) % 7;

    if (restriction.days.includes(checkDay)) {
      const nextStart = new Date(chicagoTime);
      nextStart.setDate(nextStart.getDate() + daysAhead);
      nextStart.setHours(restriction.startHour, 0, 0, 0);

      // If today and time hasn't passed yet, use it
      if (daysAhead === 0 && currentHour < restriction.startHour) {
        return nextStart;
      }

      // If future day, use it
      if (daysAhead > 0) {
        return nextStart;
      }
    }
  }

  return null;
}

/**
 * Validate permit zone status at current time
 */
export function validatePermitZone(
  zoneName: string,
  restrictionSchedule: string
): PermitZoneStatus {
  const restrictions = parsePermitRestriction(restrictionSchedule);

  // Check if currently restricted by any rule
  const activeRestriction = restrictions.find(r => isCurrentlyRestricted(r));
  const isRestricted = !!activeRestriction;

  // Find next restriction start
  let nextStart: Date | null = null;
  let nextEnd: Date | null = null;
  let hoursUntilNext = 999;

  if (!isRestricted) {
    // Find soonest upcoming restriction
    for (const restriction of restrictions) {
      const start = getNextRestrictionStart(restriction);
      if (start && (!nextStart || start < nextStart)) {
        nextStart = start;
        nextEnd = new Date(start);
        nextEnd.setHours(restriction.endHour, 0, 0, 0);
        hoursUntilNext = hoursUntil(start);
      }
    }
  } else if (activeRestriction) {
    // Currently restricted - calculate end time
    const chicagoTime = getChicagoTime();
    nextEnd = new Date(chicagoTime);
    nextEnd.setHours(activeRestriction.endHour, 0, 0, 0);

    // If end hour is before start hour (overnight), it ends tomorrow
    if (activeRestriction.endHour < activeRestriction.startHour) {
      nextEnd.setDate(nextEnd.getDate() + 1);
    }

    hoursUntilNext = 0;
  }

  // Determine severity based on user's color scheme:
  // - Critical (red): At risk NOW or within 10 minutes
  // - Warning (orange): Restriction starts later TODAY (10 min to midnight)
  // - Info (green): Restriction is tomorrow or later
  let severity: 'critical' | 'warning' | 'info' | 'none' = 'none';
  const TEN_MINUTES_IN_HOURS = 10 / 60; // ~0.167 hours

  // Check if next restriction is TODAY (same calendar day in Chicago)
  const chicagoNow = getChicagoTime();
  const isRestrictionToday = nextStart &&
    nextStart.getFullYear() === chicagoNow.getFullYear() &&
    nextStart.getMonth() === chicagoNow.getMonth() &&
    nextStart.getDate() === chicagoNow.getDate();

  if (isRestricted || hoursUntilNext <= TEN_MINUTES_IN_HOURS) {
    severity = 'critical'; // At risk NOW or within 10 minutes
  } else if (isRestrictionToday) {
    severity = 'warning'; // Restriction later TODAY
  } else if (hoursUntilNext < 999) {
    severity = 'info'; // Restriction is tomorrow or later
  }

  // Build message
  let message = '';
  const minutesUntilNext = Math.round(hoursUntilNext * 60);
  if (isRestricted) {
    message = `🅿️ PERMIT REQUIRED NOW in ${zoneName} - ${activeRestriction!.description}`;
  } else if (hoursUntilNext <= TEN_MINUTES_IN_HOURS) {
    message = `🚨 Permit required in ${minutesUntilNext} minutes! - ${zoneName}`;
  } else if (isRestrictionToday) {
    const hoursRounded = Math.round(hoursUntilNext * 10) / 10;
    message = `⚠️ Permit required in ${hoursRounded}h today - ${zoneName}`;
  } else if (hoursUntilNext < 999) {
    message = `ℹ️ Permit zone ${zoneName} - ${restrictionSchedule}`;
  } else {
    message = `Permit zone ${zoneName} - No current restrictions`;
  }

  return {
    zone_name: zoneName,
    is_currently_restricted: isRestricted,
    restriction_schedule: restrictionSchedule,
    current_status_message: message,
    next_restriction_start: nextStart,
    next_restriction_end: nextEnd,
    hours_until_restriction: hoursUntilNext,
    severity,
  };
}

/**
 * Quick check if currently restricted
 */
export function isPermitCurrentlyRequired(restrictionSchedule: string): boolean {
  const restrictions = parsePermitRestriction(restrictionSchedule);
  return restrictions.some(r => isCurrentlyRestricted(r));
}
