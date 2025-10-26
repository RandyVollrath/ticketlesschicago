/**
 * Chicago Timezone Utilities
 *
 * Handles all timezone conversions and time calculations for Chicago (America/Chicago)
 * Accounts for Central Time (CT) / Central Daylight Time (CDT)
 */

/**
 * Get current time in Chicago timezone
 */
export function getChicagoTime(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

/**
 * Convert a Date to Chicago timezone
 */
export function toChicagoTime(date: Date): Date {
  return new Date(date.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
}

/**
 * Get current hour in Chicago (0-23)
 */
export function getChicagoHour(): number {
  const chicagoTime = getChicagoTime();
  return chicagoTime.getHours();
}

/**
 * Check if current time in Chicago is within a range
 * @param startHour - Start hour (0-23)
 * @param endHour - End hour (0-23)
 */
export function isWithinChicagoHours(startHour: number, endHour: number): boolean {
  const currentHour = getChicagoHour();

  if (startHour < endHour) {
    // Normal range (e.g., 9am-5pm)
    return currentHour >= startHour && currentHour < endHour;
  } else {
    // Overnight range (e.g., 11pm-5am)
    return currentHour >= startHour || currentHour < endHour;
  }
}

/**
 * Check if we're in winter ban hours (3am-7am Chicago time)
 */
export function isWinterBanHours(): boolean {
  return isWithinChicagoHours(3, 7);
}

/**
 * Calculate hours until next winter ban starts (3am)
 */
export function hoursUntilWinterBan(): number {
  const currentHour = getChicagoHour();

  if (currentHour < 3) {
    // Before 3am today
    return 3 - currentHour;
  } else if (currentHour >= 7) {
    // After 7am today, next ban is tomorrow at 3am
    return (24 - currentHour) + 3;
  } else {
    // Currently in winter ban hours
    return 0;
  }
}

/**
 * Get day of week in Chicago (0=Sunday, 6=Saturday)
 */
export function getChicagoDayOfWeek(): number {
  const chicagoTime = getChicagoTime();
  return chicagoTime.getDay();
}

/**
 * Get Chicago date string in ISO format (YYYY-MM-DD)
 */
export function getChicagoDateISO(): string {
  const chicagoTime = getChicagoTime();
  const year = chicagoTime.getFullYear();
  const month = String(chicagoTime.getMonth() + 1).padStart(2, '0');
  const day = String(chicagoTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculate hours until a specific time
 * @param targetDate - Target date/time
 */
export function hoursUntil(targetDate: Date): number {
  const now = getChicagoTime();
  const diffMs = targetDate.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60)));
}

/**
 * Calculate minutes until a specific time
 * @param targetDate - Target date/time
 */
export function minutesUntil(targetDate: Date): number {
  const now = getChicagoTime();
  const diffMs = targetDate.getTime() - now.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60)));
}

/**
 * Format a time range in human-readable format
 * @param startHour - Start hour (0-23)
 * @param endHour - End hour (0-23)
 * @example formatTimeRange(9, 17) => "9am-5pm"
 */
export function formatTimeRange(startHour: number, endHour: number): string {
  const formatHour = (hour: number): string => {
    if (hour === 0) return '12am';
    if (hour === 12) return '12pm';
    if (hour < 12) return `${hour}am`;
    return `${hour - 12}pm`;
  };

  return `${formatHour(startHour)}-${formatHour(endHour)}`;
}

/**
 * Parse time string like "9am", "3:30pm" to hour number
 * @param timeStr - Time string (e.g., "9am", "3:30pm")
 * @returns Hour as decimal (e.g., 9, 15.5)
 */
export function parseTimeToHours(timeStr: string): number {
  const match = timeStr.match(/(\d+)(?::(\d+))?\s*(am|pm)/i);
  if (!match) throw new Error(`Invalid time format: ${timeStr}`);

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const period = match[3].toLowerCase();

  if (period === 'pm' && hours !== 12) hours += 12;
  if (period === 'am' && hours === 12) hours = 0;

  return hours + (minutes / 60);
}

/**
 * Check if a date is today in Chicago timezone
 */
export function isToday(date: Date | string): boolean {
  const dateToCheck = typeof date === 'string' ? new Date(date + 'T12:00:00Z') : date;
  const chicagoToday = getChicagoDateISO();

  const year = dateToCheck.getFullYear();
  const month = String(dateToCheck.getMonth() + 1).padStart(2, '0');
  const day = String(dateToCheck.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  return dateStr === chicagoToday;
}

/**
 * Check if a date is tomorrow in Chicago timezone
 */
export function isTomorrow(date: Date | string): boolean {
  const dateToCheck = typeof date === 'string' ? new Date(date + 'T12:00:00Z') : date;
  const chicagoTime = getChicagoTime();
  const tomorrow = new Date(chicagoTime);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const year = dateToCheck.getFullYear();
  const month = String(dateToCheck.getMonth() + 1).padStart(2, '0');
  const day = String(dateToCheck.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  const tomorrowYear = tomorrow.getFullYear();
  const tomorrowMonth = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const tomorrowDay = String(tomorrow.getDate()).padStart(2, '0');
  const tomorrowStr = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay}`;

  return dateStr === tomorrowStr;
}

/**
 * Calculate days until a date
 */
export function daysUntil(date: Date | string): number {
  const targetDate = typeof date === 'string' ? new Date(date + 'T12:00:00Z') : date;
  const chicagoToday = getChicagoTime();
  chicagoToday.setHours(0, 0, 0, 0);

  targetDate.setHours(0, 0, 0, 0);

  const diffMs = targetDate.getTime() - chicagoToday.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Format a relative time description
 * @example "in 2 hours", "tomorrow at 9am", "in 3 days"
 */
export function formatRelativeTime(targetDate: Date, includeTime = false): string {
  const hours = hoursUntil(targetDate);
  const days = daysUntil(targetDate);

  if (hours === 0) return 'now';
  if (hours < 1) return 'in less than an hour';
  if (hours === 1) return 'in 1 hour';
  if (hours < 24) return `in ${hours} hours`;

  if (days === 1) {
    if (includeTime) {
      const hour = targetDate.getHours();
      const formatHour = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
      const period = hour < 12 ? 'am' : 'pm';
      return `tomorrow at ${formatHour}${period}`;
    }
    return 'tomorrow';
  }

  if (days < 7) return `in ${days} days`;
  if (days < 14) return 'next week';
  if (days < 30) return `in ${Math.floor(days / 7)} weeks`;

  return `in ${Math.floor(days / 30)} months`;
}
