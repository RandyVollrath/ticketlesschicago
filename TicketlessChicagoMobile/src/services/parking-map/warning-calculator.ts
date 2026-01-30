/**
 * Warning Calculator
 *
 * Calculates upcoming parking restrictions and warnings for a street segment.
 * Used to notify users before restrictions start.
 */

import {
  StreetSegment,
  Restriction,
  ParkingWarning,
} from './types';

// =============================================================================
// Configuration
// =============================================================================

const DEFAULT_WARNING_WINDOW_MINUTES = 120; // 2 hours

// =============================================================================
// Main Functions
// =============================================================================

/**
 * Get upcoming warnings for a street segment
 */
export function getUpcomingWarnings(
  segment: StreetSegment,
  time: Date,
  warningWindowMinutes: number = DEFAULT_WARNING_WINDOW_MINUTES
): ParkingWarning[] {
  const warnings: ParkingWarning[] = [];

  for (const restriction of segment.properties.restrictions) {
    const nextStart = getNextRestrictionStart(restriction, time);

    if (nextStart) {
      const minutesUntil = (nextStart.getTime() - time.getTime()) / 60000;

      if (minutesUntil > 0 && minutesUntil <= warningWindowMinutes) {
        warnings.push({
          type: 'upcoming-restriction',
          minutesUntil,
          restriction,
          message: formatWarningMessage(restriction, minutesUntil),
          severity: getSeverity(restriction, minutesUntil),
        });
      }
    }
  }

  return warnings.sort((a, b) => a.minutesUntil - b.minutesUntil);
}

/**
 * Get the next time a restriction becomes active
 */
export function getNextRestrictionStart(
  restriction: Restriction,
  from: Date
): Date | null {
  const { schedule } = restriction;

  if (!schedule.daysOfWeek || !schedule.startTime) {
    return null;
  }

  const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
  const current = new Date(from);

  // Check next 7 days
  for (let i = 0; i < 7; i++) {
    const day = (current.getDay() + i) % 7;

    if (schedule.daysOfWeek.includes(day)) {
      // Check week of month if applicable
      if (schedule.weekOfMonth) {
        const weekNumber = getWeekOfMonth(current);
        if (!schedule.weekOfMonth.includes(weekNumber)) {
          current.setDate(current.getDate() + 1);
          continue;
        }
      }

      // Check seasonal dates
      if (schedule.startDate && schedule.endDate) {
        if (!isWithinSeason(current, schedule.startDate, schedule.endDate)) {
          current.setDate(current.getDate() + 1);
          continue;
        }
      }

      const candidate = new Date(current);
      candidate.setDate(candidate.getDate() + i);
      candidate.setHours(startHour, startMinute, 0, 0);

      if (candidate > from) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Get the next time a restriction ends
 */
export function getNextRestrictionEnd(
  restriction: Restriction,
  from: Date
): Date | null {
  const { schedule } = restriction;

  if (!schedule.daysOfWeek || !schedule.endTime) {
    return null;
  }

  const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
  const current = new Date(from);

  // Check next 7 days
  for (let i = 0; i < 7; i++) {
    const day = (current.getDay() + i) % 7;

    if (schedule.daysOfWeek.includes(day)) {
      const candidate = new Date(current);
      candidate.setDate(candidate.getDate() + i);
      candidate.setHours(endHour, endMinute, 0, 0);

      if (candidate > from) {
        return candidate;
      }
    }
  }

  return null;
}

/**
 * Format a human-readable warning message
 */
export function formatWarningMessage(
  restriction: Restriction,
  minutesUntil: number
): string {
  const timeStr =
    minutesUntil < 60
      ? `${Math.round(minutesUntil)} minutes`
      : minutesUntil < 120
        ? '1 hour'
        : `${Math.round(minutesUntil / 60)} hours`;

  switch (restriction.type) {
    case 'street-cleaning':
      return `Street cleaning starts in ${timeStr}`;

    case 'alternate-side':
      return `Alternate side parking starts in ${timeStr}`;

    case 'tow-away':
      return `TOW ZONE in ${timeStr} - move your car!`;

    case 'snow-emergency':
    case 'snow-route':
    case 'winter-ban':
      return `Snow route restrictions in ${timeStr}`;

    case 'permit-zone':
      return `Permit-only parking starts in ${timeStr}`;

    case 'metered':
      return `Metered parking starts in ${timeStr}`;

    case 'time-limit':
      return `Time limit parking starts in ${timeStr}`;

    case 'loading-zone':
      return `Loading zone restrictions in ${timeStr}`;

    case 'event':
      return `Event parking restrictions in ${timeStr}`;

    case 'overnight-ban':
      return `Overnight parking ban starts in ${timeStr}`;

    default:
      return `Parking restriction starts in ${timeStr}`;
  }
}

/**
 * Get severity level for a restriction warning
 */
export function getSeverity(
  restriction: Restriction,
  minutesUntil: number
): 'low' | 'medium' | 'high' {
  // High severity for tow risks or imminent restrictions
  if (minutesUntil <= 15) {
    return 'high';
  }

  // Check for tow risk restrictions
  const towRiskTypes = ['tow-away', 'snow-emergency', 'snow-route'];
  if (towRiskTypes.includes(restriction.type)) {
    return minutesUntil <= 60 ? 'high' : 'medium';
  }

  // Medium severity for restrictions in the next hour
  if (minutesUntil <= 60) {
    return 'medium';
  }

  return 'low';
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get the week of month (1-5) for a date
 */
function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfMonth = date.getDate();
  return Math.ceil((dayOfMonth + firstDay.getDay()) / 7);
}

/**
 * Check if a date is within a seasonal range (MM-DD format)
 */
function isWithinSeason(
  date: Date,
  startDate: string,
  endDate: string
): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dateValue = month * 100 + day;

  const [startMonth, startDay] = startDate.split('-').map(Number);
  const [endMonth, endDay] = endDate.split('-').map(Number);

  const startValue = startMonth * 100 + startDay;
  const endValue = endMonth * 100 + endDay;

  // Handle wrap-around seasons (e.g., Dec 1 to Apr 1)
  if (startValue > endValue) {
    return dateValue >= startValue || dateValue <= endValue;
  }

  return dateValue >= startValue && dateValue <= endValue;
}

/**
 * Calculate minutes until a restriction
 */
export function getMinutesUntil(targetTime: Date, from: Date): number {
  return (targetTime.getTime() - from.getTime()) / 60000;
}

/**
 * Format time remaining in a friendly way
 */
export function formatTimeRemaining(minutes: number): string {
  if (minutes < 1) {
    return 'less than a minute';
  }

  if (minutes < 60) {
    const rounded = Math.round(minutes);
    return `${rounded} minute${rounded === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);

  if (remainingMinutes === 0) {
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${hours} hour${hours === 1 ? '' : 's'} ${remainingMinutes} min`;
}

// =============================================================================
// Exports
// =============================================================================

export default {
  getUpcomingWarnings,
  getNextRestrictionStart,
  getNextRestrictionEnd,
  formatWarningMessage,
  getSeverity,
  getMinutesUntil,
  formatTimeRemaining,
};
