/**
 * Boston Street Sweeping Utilities
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface BostonStreetSweepingSchedule {
  id: number;
  st_name: string;
  dist: string | null;
  dist_name: string | null;
  start_time: string;
  end_time: string;
  side: string | null; // Even, Odd, or null (both sides)
  from_street: string | null;
  to_street: string | null;
  week_1: boolean;
  week_2: boolean;
  week_3: boolean;
  week_4: boolean;
  week_5: boolean;
  sunday: boolean;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  every_day: boolean;
  year_round: boolean;
}

export interface NextCleaningEvent {
  date: Date;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  streetName: string;
  side: string | null;
}

/**
 * Get week of month (1-5) for a given date
 */
function getWeekOfMonth(date: Date): number {
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
  const dayOfMonth = date.getDate();
  const weekNumber = Math.ceil((dayOfMonth + firstDay.getDay()) / 7);
  return Math.min(weekNumber, 5);
}

/**
 * Calculate the next cleaning date for a given Boston schedule
 */
export function calculateNextCleaning(
  schedule: BostonStreetSweepingSchedule,
  fromDate: Date = new Date()
): NextCleaningEvent | null {
  const today = new Date(fromDate);
  today.setHours(0, 0, 0, 0);

  // Boston street sweeping: April 1 - November 30
  const currentYear = today.getFullYear();
  const seasonStart = new Date(currentYear, 3, 1); // April 1
  const seasonEnd = new Date(currentYear, 10, 30); // November 30

  // If year-round, no season restriction
  if (!schedule.year_round) {
    // If before season, start from April 1
    if (today < seasonStart) {
      today.setTime(seasonStart.getTime());
    }
    // If after season, no cleanings this year
    if (today > seasonEnd) {
      return null;
    }
  }

  const dayMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const maxDaysToCheck = 60;

  for (let daysAhead = 0; daysAhead < maxDaysToCheck; daysAhead++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() + daysAhead);

    // Skip if past season end (for non-year-round)
    if (!schedule.year_round && checkDate > seasonEnd) {
      break;
    }

    const dayOfWeek = checkDate.getDay();
    const weekOfMonth = getWeekOfMonth(checkDate);
    const dayName = dayMap[dayOfWeek] as keyof BostonStreetSweepingSchedule;

    // Check if this day matches the schedule
    const isDayMatch = schedule.every_day || schedule[dayName as any];
    if (!isDayMatch) continue;

    // Check if this week matches
    const weekField = `week_${weekOfMonth}` as keyof BostonStreetSweepingSchedule;
    const isWeekMatch = schedule[weekField as any];
    if (!isWeekMatch) continue;

    // Found a match!
    return {
      date: checkDate,
      dayOfWeek: dayMap[dayOfWeek],
      startTime: schedule.start_time,
      endTime: schedule.end_time,
      streetName: schedule.st_name,
      side: schedule.side
    };
  }

  return null;
}

/**
 * Find street sweeping schedule by street name
 */
export async function findScheduleByStreetName(
  streetName: string
): Promise<BostonStreetSweepingSchedule[]> {
  const { data, error } = await supabase
    .from('boston_street_sweeping')
    .select('*')
    .ilike('st_name', `%${streetName}%`)
    .order('st_name', { ascending: true });

  if (error) {
    console.error('Error fetching Boston street sweeping schedule:', error);
    return [];
  }

  return data || [];
}

/**
 * Generate Google Calendar link for Boston cleaning event
 */
export function generateGoogleCalendarLink(event: NextCleaningEvent): string {
  const { date, startTime, endTime, streetName, side } = event;

  const [startHour, startMin] = startTime.split(':');
  const [endHour, endMin] = endTime.split(':');

  const startDateTime = new Date(date);
  startDateTime.setHours(parseInt(startHour), parseInt(startMin), 0);

  const endDateTime = new Date(date);
  endDateTime.setHours(parseInt(endHour), parseInt(endMin), 0);

  const formatDateTime = (d: Date) => {
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    const day = d.getDate().toString().padStart(2, '0');
    const hour = d.getHours().toString().padStart(2, '0');
    const min = d.getMinutes().toString().padStart(2, '0');
    const sec = d.getSeconds().toString().padStart(2, '0');
    return `${year}${month}${day}T${hour}${min}${sec}`;
  };

  const start = formatDateTime(startDateTime);
  const end = formatDateTime(endDateTime);

  const title = encodeURIComponent(`Move Car - Street Cleaning`);
  const sideInfo = side ? ` (${side} side)` : '';
  const details = encodeURIComponent(
    `Street cleaning on ${streetName}${sideInfo}\n\n` +
    `Make sure to move your car before ${startTime} to avoid a ticket!\n\n` +
    `Powered by Autopilot America`
  );
  const location = encodeURIComponent(`${streetName}, Boston, MA`);

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${start}/${end}&details=${details}&location=${location}`;
}

/**
 * Format next cleaning event for display
 */
export function formatNextCleaning(event: NextCleaningEvent): string {
  const dateStr = event.date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });

  return `${dateStr}, ${event.startTime} - ${event.endTime}`;
}

/**
 * Generate .ics calendar file with ALL cleaning events for the season
 */
export function generateICSFile(events: NextCleaningEvent[], address: string): string {
  const icsEvents: string[] = [];

  // Generate events for the rest of the season
  const endDate = new Date();
  endDate.setMonth(10, 30); // November 30

  for (const event of events) {
    let currentDate = new Date(event.date);

    while (currentDate <= endDate) {
      const startDateTime = new Date(currentDate);
      const [startHour, startMin] = event.startTime.split(':');
      startDateTime.setHours(parseInt(startHour), parseInt(startMin), 0);

      const endDateTime = new Date(currentDate);
      const [endHour, endMin] = event.endTime.split(':');
      endDateTime.setHours(parseInt(endHour), parseInt(endMin), 0);

      const formatICS = (d: Date) => {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        const hour = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        const sec = d.getSeconds().toString().padStart(2, '0');
        return `${year}${month}${day}T${hour}${min}${sec}`;
      };

      const uid = `boston-sweep-${event.streetName.replace(/\s/g, '-')}-${formatICS(startDateTime)}@autopilotamerica.com`;

      icsEvents.push(`BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatICS(new Date())}
DTSTART:${formatICS(startDateTime)}
DTEND:${formatICS(endDateTime)}
SUMMARY:Move Car - Street Cleaning
DESCRIPTION:Street cleaning on ${event.streetName}${event.side ? ` (${event.side} side)` : ''}\\n\\nMake sure to move your car before ${event.startTime}!\\n\\nPowered by Autopilot America
LOCATION:${event.streetName}, Boston, MA
STATUS:CONFIRMED
SEQUENCE:0
BEGIN:VALARM
TRIGGER:-PT12H
DESCRIPTION:Street cleaning tomorrow on ${event.streetName}
ACTION:DISPLAY
END:VALARM
END:VEVENT`);

      currentDate.setDate(currentDate.getDate() + 7);
    }
  }

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Autopilot America//Boston Street Sweeping//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Boston Street Sweeping - ${address}
X-WR-TIMEZONE:America/New_York
X-WR-CALDESC:Street sweeping schedule for ${address} in Boston
${icsEvents.join('\n')}
END:VCALENDAR`;

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  return URL.createObjectURL(blob);
}
