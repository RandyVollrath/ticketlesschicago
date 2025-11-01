// San Diego Street Sweeping Utilities

export interface SDStreetSweepingSchedule {
  id: number;
  objectid: number | null;
  sapid: string | null;
  rd20full: string | null; // Street name
  llowaddr: string | null;
  lhighaddr: string | null;
  rlowaddr: string | null;
  rhighaddr: string | null;
  xstrt1: string | null; // Cross street from
  xstrt2: string | null; // Cross street to
  cdcode: string | null;
  cpcode: string | null;
  zip: string | null;
  posted: string | null;
  schedule: string | null; // e.g., "Not Posted, Both Sides 4th Mon"
  schedule2: string | null;
  segment_lat: number | null;
  segment_lng: number | null;
}

export interface NextCleaningEvent {
  date: Date;
  streetName: string;
  side: string | null;
  weekOfMonth: string;
  dayOfWeek: string;
  startTime?: string;
  endTime?: string;
}

/**
 * Parse San Diego schedule string
 * Examples:
 * - "Not Posted, Both Sides 4th Mon"
 * - "Posted (10am - 1pm), Left Side 1st Fri"
 * - "Posted (7am - 10am), Right Side 3rd Wed"
 */
export function parseSDSchedule(schedule: string): {
  side: string | null;
  weekOfMonth: number | null;
  dayOfWeek: number | null; // 0 = Sunday, 6 = Saturday
  startTime: string | null;
  endTime: string | null;
} | null {
  if (!schedule || schedule.trim() === '') return null;

  // Extract side (Both, Left, Right, North, South, East, West)
  let side: string | null = null;
  if (schedule.includes('Both Sides')) side = 'Both';
  else if (schedule.includes('Left Side') || schedule.includes('LS')) side = 'Left';
  else if (schedule.includes('Right Side') || schedule.includes('RS')) side = 'Right';
  else if (schedule.includes('North Side') || schedule.includes('NS')) side = 'North';
  else if (schedule.includes('South Side') || schedule.includes('SS')) side = 'South';
  else if (schedule.includes('East Side') || schedule.includes('ES')) side = 'East';
  else if (schedule.includes('West Side') || schedule.includes('WS')) side = 'West';

  // Extract week of month (1st, 2nd, 3rd, 4th, 5th)
  let weekOfMonth: number | null = null;
  if (schedule.includes('1st')) weekOfMonth = 1;
  else if (schedule.includes('2nd')) weekOfMonth = 2;
  else if (schedule.includes('3rd')) weekOfMonth = 3;
  else if (schedule.includes('4th')) weekOfMonth = 4;
  else if (schedule.includes('5th')) weekOfMonth = 5;

  // Extract day of week
  let dayOfWeek: number | null = null;
  if (schedule.includes(' Mon')) dayOfWeek = 1;
  else if (schedule.includes(' Tue')) dayOfWeek = 2;
  else if (schedule.includes(' Wed')) dayOfWeek = 3;
  else if (schedule.includes(' Thu')) dayOfWeek = 4;
  else if (schedule.includes(' Fri')) dayOfWeek = 5;
  else if (schedule.includes(' Sat')) dayOfWeek = 6;
  else if (schedule.includes(' Sun')) dayOfWeek = 0;

  // Extract time (e.g., "7am - 10am", "10am-1pm")
  let startTime: string | null = null;
  let endTime: string | null = null;
  const timeMatch = schedule.match(/(\d+)(am|pm)\s*-\s*(\d+)(am|pm)/i);
  if (timeMatch) {
    startTime = timeMatch[1] + timeMatch[2].toLowerCase();
    endTime = timeMatch[3] + timeMatch[4].toLowerCase();
  }

  if (weekOfMonth === null || dayOfWeek === null) {
    return null;
  }

  return { side, weekOfMonth, dayOfWeek, startTime, endTime };
}

/**
 * Calculate the next cleaning date for a given schedule
 */
export function calculateNextCleaning(
  schedule: SDStreetSweepingSchedule,
  fromDate: Date = new Date()
): NextCleaningEvent | null {
  const parsed = parseSDSchedule(schedule.schedule || '');
  if (!parsed) return null;

  const { weekOfMonth, dayOfWeek, side, startTime, endTime } = parsed;
  if (weekOfMonth === null || dayOfWeek === null) return null;

  // Start from tomorrow
  const searchDate = new Date(fromDate);
  searchDate.setDate(searchDate.getDate() + 1);
  searchDate.setHours(0, 0, 0, 0);

  // Search up to 12 months ahead
  const maxDate = new Date(searchDate);
  maxDate.setMonth(maxDate.getMonth() + 12);

  while (searchDate < maxDate) {
    const currentDay = searchDate.getDay();
    const currentMonth = searchDate.getMonth();
    const currentYear = searchDate.getFullYear();

    if (currentDay === dayOfWeek) {
      // Check if this is the Nth occurrence of this weekday in the month
      const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
      const firstOccurrence = new Date(firstDayOfMonth);
      const daysUntilFirst = (dayOfWeek - firstDayOfMonth.getDay() + 7) % 7;
      firstOccurrence.setDate(1 + daysUntilFirst);

      const weekNumber = Math.floor((searchDate.getDate() - firstOccurrence.getDate()) / 7) + 1;

      if (weekNumber === weekOfMonth) {
        return {
          date: new Date(searchDate),
          streetName: schedule.rd20full || 'Unknown',
          side: side,
          weekOfMonth: getWeekName(weekOfMonth),
          dayOfWeek: getDayName(dayOfWeek),
          startTime: startTime || undefined,
          endTime: endTime || undefined
        };
      }
    }

    searchDate.setDate(searchDate.getDate() + 1);
  }

  return null;
}

function getWeekName(week: number): string {
  const names = ['', '1st', '2nd', '3rd', '4th', '5th'];
  return names[week] || '';
}

function getDayName(day: number): string {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[day] || '';
}

/**
 * Format next cleaning event for display
 */
export function formatNextCleaning(event: NextCleaningEvent): string {
  const dateStr = event.date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  let timeStr = '';
  if (event.startTime && event.endTime) {
    timeStr = ` (${event.startTime} - ${event.endTime})`;
  }

  return `${dateStr}${timeStr}`;
}

/**
 * Generate Google Calendar link
 */
export function generateGoogleCalendarLink(event: NextCleaningEvent): string {
  const title = `Street Cleaning - ${event.streetName}`;
  const details = `Street cleaning on ${event.streetName}${event.side ? ` (${event.side} side)` : ''}`;

  // Default to 7am-10am if no time specified
  const startHour = event.startTime ? parseTimeToHour(event.startTime) : 7;
  const endHour = event.endTime ? parseTimeToHour(event.endTime) : 10;

  const startDate = new Date(event.date);
  startDate.setHours(startHour, 0, 0);

  const endDate = new Date(event.date);
  endDate.setHours(endHour, 0, 0);

  const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: details,
    dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
    ctz: 'America/Los_Angeles'
  });

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function parseTimeToHour(time: string): number {
  const match = time.match(/(\d+)(am|pm)/i);
  if (!match) return 7;

  let hour = parseInt(match[1]);
  const period = match[2].toLowerCase();

  if (period === 'pm' && hour !== 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;

  return hour;
}

/**
 * Generate ICS file for calendar download
 */
export function generateICSFile(events: NextCleaningEvent[], address: string): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Autopilot America//San Diego Street Sweeping//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:San Diego Street Sweeping',
    'X-WR-TIMEZONE:America/Los_Angeles'
  ];

  for (const event of events) {
    const startHour = event.startTime ? parseTimeToHour(event.startTime) : 7;
    const endHour = event.endTime ? parseTimeToHour(event.endTime) : 10;

    const startDate = new Date(event.date);
    startDate.setHours(startHour, 0, 0);

    const endDate = new Date(event.date);
    endDate.setHours(endHour, 0, 0);

    const formatDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    lines.push(
      'BEGIN:VEVENT',
      `DTSTART:${formatDate(startDate)}`,
      `DTEND:${formatDate(endDate)}`,
      `SUMMARY:Street Cleaning - ${event.streetName}`,
      `DESCRIPTION:Street cleaning on ${event.streetName}${event.side ? ` (${event.side} side)` : ''}`,
      `LOCATION:${address}, San Diego, CA`,
      `UID:${event.date.getTime()}-${event.streetName}@autopilotamerica.com`,
      'END:VEVENT'
    );
  }

  lines.push('END:VCALENDAR');

  const icsContent = lines.join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`;
}
