/**
 * Parking Status Computation Engine
 *
 * Computes parking status for street segments based on:
 * - Current time (or simulated time)
 * - Active restrictions
 * - Weather conditions (snow emergency)
 * - User's permits
 */

import {
  StreetSegment,
  Restriction,
  RestrictionSchedule,
  ParkingStatus,
  ParkingStatusResponse,
  ParkingStatusReason,
  WeatherConditions,
} from './types';

// =============================================================================
// Main Computation Functions
// =============================================================================

/**
 * Compute parking status for a street segment at a given time
 */
export function computeParkingStatus(
  segment: StreetSegment,
  time: Date,
  userPermits: string[] = [],
  weatherConditions?: WeatherConditions
): ParkingStatusResponse {
  const activeRestrictions: Restriction[] = [];
  const { restrictions } = segment.properties;

  // Check each restriction
  for (const restriction of restrictions) {
    if (isRestrictionActive(restriction, time, weatherConditions)) {
      // Check if user has permit that exempts them
      if (
        restriction.type === 'permit-zone' &&
        restriction.schedule.permitZone &&
        userPermits.includes(restriction.schedule.permitZone)
      ) {
        continue; // User is exempt
      }
      activeRestrictions.push(restriction);
    }
  }

  // No active restrictions = allowed
  if (activeRestrictions.length === 0) {
    const nextRestriction = findNextRestriction(segment, time, weatherConditions);
    const isWarning = nextRestriction && isWithinWarningWindow(nextRestriction.time, time);

    return {
      status: isWarning ? 'warning' : 'allowed',
      reasons: isWarning
        ? [
            {
              type: nextRestriction.restriction.type,
              description: `Restriction starting at ${formatTime(nextRestriction.time)}`,
              activeUntil: nextRestriction.time,
            },
          ]
        : [],
      nextChange: nextRestriction
        ? {
            time: nextRestriction.time,
            toStatus: 'restricted',
            reason: formatRestrictionDescription(nextRestriction.restriction),
          }
        : undefined,
    };
  }

  // Active restrictions = restricted
  return {
    status: 'restricted',
    reasons: activeRestrictions.map((r) => ({
      type: r.type,
      description: formatRestrictionDescription(r),
      activeUntil: getRestrictionEndTime(r, time),
    })),
  };
}

/**
 * Compute status for multiple segments (batch processing)
 */
export function computeBatchParkingStatus(
  segments: StreetSegment[],
  time: Date,
  userPermits: string[] = [],
  weatherConditions?: WeatherConditions
): Map<string, ParkingStatusResponse> {
  const results = new Map<string, ParkingStatusResponse>();

  for (const segment of segments) {
    const status = computeParkingStatus(segment, time, userPermits, weatherConditions);
    results.set(segment.properties.segmentId, status);
  }

  return results;
}

/**
 * Update segment properties with computed status
 */
export function updateSegmentStatus(
  segment: StreetSegment,
  time: Date,
  userPermits: string[] = [],
  weatherConditions?: WeatherConditions
): StreetSegment {
  const status = computeParkingStatus(segment, time, userPermits, weatherConditions);

  return {
    ...segment,
    properties: {
      ...segment.properties,
      currentStatus: status.status,
      statusReason: status.reasons[0]?.description,
      nextChange: status.nextChange
        ? {
            time: status.nextChange.time,
            toStatus: status.nextChange.toStatus,
          }
        : undefined,
    },
  };
}

// =============================================================================
// Restriction Checking Functions
// =============================================================================

/**
 * Check if a restriction is currently active
 */
export function isRestrictionActive(
  restriction: Restriction,
  time: Date,
  weather?: WeatherConditions
): boolean {
  const schedule = restriction.schedule;

  // Check conditional restrictions first (snow routes)
  if (restriction.type === 'snow-route') {
    return weather?.snowEmergencyActive ?? false;
  }

  // Check winter ban (Dec 1 - Apr 1, 3am-7am)
  if (restriction.type === 'winter-ban') {
    return isWinterBanActive(time, weather);
  }

  // Check seasonal bounds
  if (schedule.startDate && schedule.endDate) {
    if (!isWithinDateRange(time, schedule.startDate, schedule.endDate)) {
      return false;
    }
  }

  // Check day of week
  if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
    if (!schedule.daysOfWeek.includes(time.getDay())) {
      return false;
    }
  }

  // Check week of month
  if (schedule.weekOfMonth && schedule.weekOfMonth.length > 0) {
    const weekNum = getWeekOfMonth(time);
    if (!schedule.weekOfMonth.includes(weekNum)) {
      return false;
    }
  }

  // Check time of day
  if (schedule.startTime && schedule.endTime) {
    if (!isWithinTimeRange(time, schedule.startTime, schedule.endTime)) {
      return false;
    }
  }

  // Check permit zones during restricted hours
  if (restriction.type === 'permit-zone' && schedule.permitHours) {
    const [startHour, endHour] = parsePermitHours(schedule.permitHours);
    const hour = time.getHours();

    // Handle overnight ranges (e.g., 6pm-6am = 18-6)
    if (startHour > endHour) {
      if (!(hour >= startHour || hour < endHour)) {
        return false;
      }
    } else {
      if (!(hour >= startHour && hour < endHour)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if winter overnight ban is active
 * Dec 1 - Apr 1, 3am-7am
 */
function isWinterBanActive(time: Date, weather?: WeatherConditions): boolean {
  // Check if winter ban period (Dec 1 - Apr 1)
  const month = time.getMonth() + 1; // 1-12
  const isWinterPeriod = month === 12 || month <= 3 || (month === 4 && time.getDate() === 1);

  if (!isWinterPeriod) {
    return false;
  }

  // Check time (3am - 7am)
  const hour = time.getHours();
  const isOvernightHours = hour >= 3 && hour < 7;

  if (!isOvernightHours) {
    return false;
  }

  // Winter ban only active when snow conditions exist
  // (In Chicago, it's automatic Dec 1 - Apr 1 regardless of snow)
  return true;
}

// =============================================================================
// Time/Date Helper Functions
// =============================================================================

/**
 * Check if date is within a month-day range
 */
function isWithinDateRange(date: Date, startStr: string, endStr: string): boolean {
  const [startMonth, startDay] = startStr.split('-').map(Number);
  const [endMonth, endDay] = endStr.split('-').map(Number);

  const month = date.getMonth() + 1;
  const day = date.getDate();

  // Handle year-wrap (e.g., Dec 1 - Apr 1)
  if (startMonth > endMonth) {
    return (
      (month > startMonth || (month === startMonth && day >= startDay)) ||
      (month < endMonth || (month === endMonth && day <= endDay))
    );
  }

  // Normal range
  if (month < startMonth || month > endMonth) {
    return false;
  }
  if (month === startMonth && day < startDay) {
    return false;
  }
  if (month === endMonth && day > endDay) {
    return false;
  }

  return true;
}

/**
 * Check if time is within a time range
 */
function isWithinTimeRange(date: Date, startStr: string, endStr: string): boolean {
  const [startHour, startMin] = startStr.split(':').map(Number);
  const [endHour, endMin] = endStr.split(':').map(Number);

  const hour = date.getHours();
  const min = date.getMinutes();

  const currentMinutes = hour * 60 + min;
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;

  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Get week of month (1-5)
 */
function getWeekOfMonth(date: Date): number {
  const dayOfMonth = date.getDate();
  return Math.ceil(dayOfMonth / 7);
}

/**
 * Parse permit hours string like "6pm-6am"
 */
function parsePermitHours(hours: string): [number, number] {
  const match = hours.match(/(\d+)(am|pm)-(\d+)(am|pm)/i);
  if (!match) {
    return [18, 6]; // Default 6pm-6am
  }

  let startHour = parseInt(match[1]);
  const startPeriod = match[2].toLowerCase();
  let endHour = parseInt(match[3]);
  const endPeriod = match[4].toLowerCase();

  if (startPeriod === 'pm' && startHour !== 12) startHour += 12;
  if (startPeriod === 'am' && startHour === 12) startHour = 0;
  if (endPeriod === 'pm' && endHour !== 12) endHour += 12;
  if (endPeriod === 'am' && endHour === 12) endHour = 0;

  return [startHour, endHour];
}

// =============================================================================
// Next Change Functions
// =============================================================================

/**
 * Find when the next restriction starts
 */
function findNextRestriction(
  segment: StreetSegment,
  fromTime: Date,
  weather?: WeatherConditions
): { time: Date; restriction: Restriction } | undefined {
  const { restrictions } = segment.properties;
  let nextChange: { time: Date; restriction: Restriction } | undefined;

  for (const restriction of restrictions) {
    // Skip conditional restrictions (can't predict snow)
    if (restriction.type === 'snow-route') {
      continue;
    }

    const nextStart = findNextRestrictionStart(restriction, fromTime);
    if (nextStart && (!nextChange || nextStart < nextChange.time)) {
      nextChange = { time: nextStart, restriction };
    }
  }

  return nextChange;
}

/**
 * Find next start time for a specific restriction
 */
function findNextRestrictionStart(restriction: Restriction, fromTime: Date): Date | undefined {
  const schedule = restriction.schedule;

  // Need day and time info
  if (!schedule.daysOfWeek || !schedule.startTime) {
    return undefined;
  }

  const [startHour, startMin] = schedule.startTime.split(':').map(Number);
  const currentDay = fromTime.getDay();
  const currentHour = fromTime.getHours();
  const currentMin = fromTime.getMinutes();

  // Find next occurrence
  for (let dayOffset = 0; dayOffset <= 7; dayOffset++) {
    const checkDay = (currentDay + dayOffset) % 7;

    if (schedule.daysOfWeek.includes(checkDay)) {
      // Check week of month if specified
      if (schedule.weekOfMonth && schedule.weekOfMonth.length > 0) {
        const futureDate = new Date(fromTime);
        futureDate.setDate(futureDate.getDate() + dayOffset);
        const weekNum = getWeekOfMonth(futureDate);
        if (!schedule.weekOfMonth.includes(weekNum)) {
          continue;
        }
      }

      const nextStart = new Date(fromTime);
      nextStart.setDate(nextStart.getDate() + dayOffset);
      nextStart.setHours(startHour, startMin, 0, 0);

      // Make sure it's in the future
      if (nextStart > fromTime) {
        // Check seasonal bounds
        if (schedule.startDate && schedule.endDate) {
          if (!isWithinDateRange(nextStart, schedule.startDate, schedule.endDate)) {
            continue;
          }
        }
        return nextStart;
      }
    }
  }

  return undefined;
}

/**
 * Get when a restriction ends
 */
function getRestrictionEndTime(restriction: Restriction, currentTime: Date): Date | undefined {
  const schedule = restriction.schedule;

  if (!schedule.endTime) {
    return undefined;
  }

  const [endHour, endMin] = schedule.endTime.split(':').map(Number);
  const endTime = new Date(currentTime);
  endTime.setHours(endHour, endMin, 0, 0);

  // If end time is before current time, it must be tomorrow
  if (endTime <= currentTime) {
    endTime.setDate(endTime.getDate() + 1);
  }

  return endTime;
}

/**
 * Check if a time is within warning window (2 hours)
 */
function isWithinWarningWindow(restrictionTime: Date, currentTime: Date): boolean {
  const diff = restrictionTime.getTime() - currentTime.getTime();
  const twoHours = 2 * 60 * 60 * 1000;
  return diff > 0 && diff <= twoHours;
}

// =============================================================================
// Formatting Functions
// =============================================================================

/**
 * Format restriction description for display
 */
export function formatRestrictionDescription(restriction: Restriction): string {
  const { type, schedule } = restriction;

  switch (type) {
    case 'street-cleaning':
      return formatStreetCleaningDescription(schedule);
    case 'snow-route':
      return 'Snow emergency route - No parking when 2"+ snow';
    case 'winter-ban':
      return 'Winter overnight ban - No parking 3am-7am (Dec 1 - Apr 1)';
    case 'permit-zone':
      return `Permit Zone ${schedule.permitZone} - ${schedule.permitHours || '6pm-6am'}`;
    default:
      return restriction.description || 'Parking restricted';
  }
}

function formatStreetCleaningDescription(schedule: RestrictionSchedule): string {
  const days = schedule.daysOfWeek?.map(dayNumberToName).join(', ') || 'Unknown days';
  const time = schedule.startTime && schedule.endTime
    ? `${formatTimeString(schedule.startTime)} - ${formatTimeString(schedule.endTime)}`
    : 'Unknown time';
  const weeks = schedule.weekOfMonth
    ? schedule.weekOfMonth.map(w => `${ordinal(w)} week`).join(', ')
    : '';

  let desc = `Street cleaning: ${days} ${time}`;
  if (weeks) {
    desc += ` (${weeks})`;
  }
  return desc;
}

function dayNumberToName(day: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return days[day] || 'Unknown';
}

function ordinal(n: number): string {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

function formatTimeString(time: string): string {
  const [hour, min] = time.split(':').map(Number);
  const period = hour >= 12 ? 'PM' : 'AM';
  const hour12 = hour % 12 || 12;
  return `${hour12}:${min.toString().padStart(2, '0')} ${period}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export default {
  computeParkingStatus,
  computeBatchParkingStatus,
  updateSegmentStatus,
  isRestrictionActive,
  formatRestrictionDescription,
};
