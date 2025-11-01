/**
 * San Francisco Street Sweeping Utilities
 *
 * Functions for:
 * - Geocoding addresses to street segments
 * - Calculating next cleaning dates
 * - Generating Google Calendar links
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export interface SFStreetSweepingSchedule {
  id: number;
  cnn: string;
  corridor: string;
  limits: string | null;
  block_side: string | null;
  full_name: string | null;
  week_day: string;
  from_hour: number;
  to_hour: number;
  week1: number;
  week2: number;
  week3: number;
  week4: number;
  week5: number;
  holidays: number;
  geom: any;
}

export interface NextCleaningEvent {
  date: Date;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  streetName: string;
  blockSide: string | null;
}

/**
 * Day name mapping
 */
const DAY_MAP: { [key: string]: number } = {
  'Sun': 0,
  'Mon': 1,
  'Tues': 2,
  'Wed': 3,
  'Thu': 4,
  'Fri': 5,
  'Sat': 6
};

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
 * Calculate the next cleaning date for a given schedule
 */
export function calculateNextCleaning(
  schedule: SFStreetSweepingSchedule,
  fromDate: Date = new Date()
): NextCleaningEvent | null {
  const dayNum = DAY_MAP[schedule.week_day];

  if (dayNum === undefined) {
    console.error('Invalid week_day:', schedule.week_day);
    return null;
  }

  // Find the next occurrence of this day of week
  let nextDate = new Date(fromDate);
  nextDate.setHours(0, 0, 0, 0);

  // Advance to the next occurrence of the target day
  while (nextDate.getDay() !== dayNum) {
    nextDate.setDate(nextDate.getDate() + 1);
  }

  // Check if this week matches the schedule pattern
  const maxIterations = 60; // Check up to 60 days ahead
  let iterations = 0;

  while (iterations < maxIterations) {
    const weekOfMonth = getWeekOfMonth(nextDate);

    // Check if this week is scheduled for cleaning
    const isScheduled =
      (weekOfMonth === 1 && schedule.week1 === 1) ||
      (weekOfMonth === 2 && schedule.week2 === 1) ||
      (weekOfMonth === 3 && schedule.week3 === 1) ||
      (weekOfMonth === 4 && schedule.week4 === 1) ||
      (weekOfMonth === 5 && schedule.week5 === 1);

    if (isScheduled) {
      // Found the next cleaning date
      const startTime = `${schedule.from_hour.toString().padStart(2, '0')}:00`;
      const endTime = `${schedule.to_hour.toString().padStart(2, '0')}:00`;

      return {
        date: nextDate,
        dayOfWeek: schedule.week_day,
        startTime,
        endTime,
        streetName: schedule.corridor,
        blockSide: schedule.block_side
      };
    }

    // Move to next week
    nextDate.setDate(nextDate.getDate() + 7);
    iterations++;
  }

  return null;
}

/**
 * Find street sweeping schedule by exact street name match
 */
export async function findScheduleByStreetName(
  streetName: string
): Promise<SFStreetSweepingSchedule[]> {
  const { data, error } = await supabase
    .from('sf_street_sweeping')
    .select('*')
    .ilike('corridor', streetName)
    .order('from_hour', { ascending: true });

  if (error) {
    console.error('Error fetching SF street sweeping schedule:', error);
    return [];
  }

  return data || [];
}

/**
 * Find street sweeping schedule by geocoded address
 * Uses Google Geocoding API to get coordinates, then finds nearest street segment
 */
export async function findScheduleByAddress(
  address: string,
  googleApiKey: string
): Promise<SFStreetSweepingSchedule[]> {
  // Geocode the address using Google API
  const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address + ', San Francisco, CA')}&key=${googleApiKey}`;

  try {
    const response = await fetch(geocodeUrl);
    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      console.error('Geocoding failed:', data.status);
      return [];
    }

    const location = data.results[0].geometry.location;
    const { lat, lng } = location;

    // Find nearest street segment using PostGIS ST_Distance
    const { data: schedules, error } = await supabase.rpc('find_nearest_sf_street', {
      lat,
      lng,
      max_distance_meters: 100 // Within 100 meters
    });

    if (error) {
      console.error('Error finding nearest SF street:', error);
      return [];
    }

    return schedules || [];
  } catch (err) {
    console.error('Error geocoding address:', err);
    return [];
  }
}

/**
 * Generate Google Calendar deep link for a cleaning event
 * Opens directly in Google Calendar (no .ics download needed)
 */
export function generateGoogleCalendarLink(event: NextCleaningEvent): string {
  const { date, startTime, endTime, streetName, blockSide } = event;

  // Format dates for Google Calendar
  const [startHour, startMin] = startTime.split(':');
  const [endHour, endMin] = endTime.split(':');

  const startDateTime = new Date(date);
  startDateTime.setHours(parseInt(startHour), parseInt(startMin), 0);

  const endDateTime = new Date(date);
  endDateTime.setHours(parseInt(endHour), parseInt(endMin), 0);

  // Format as YYYYMMDDTHHMMSS
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

  // Build calendar parameters
  const title = encodeURIComponent(`Move Car - Street Cleaning`);
  const details = encodeURIComponent(
    `Street cleaning on ${streetName}${blockSide ? ` (${blockSide} side)` : ''}\n\n` +
    `Make sure to move your car before ${startTime} to avoid a ticket!\n\n` +
    `Powered by Autopilot America`
  );
  const location = encodeURIComponent(`${streetName}, San Francisco, CA`);

  // Google Calendar URL format
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
 * Generate .ics calendar file with ALL cleaning events for next 12 months
 * Returns data URL that can be downloaded
 */
export function generateICSFile(events: NextCleaningEvent[], address: string): string {
  const icsEvents: string[] = [];

  // Generate events for next 12 months
  const endDate = new Date();
  endDate.setFullYear(endDate.getFullYear() + 1);

  for (const event of events) {
    let currentDate = new Date(event.date);

    while (currentDate < endDate) {
      const startDateTime = new Date(currentDate);
      const [startHour, startMin] = event.startTime.split(':');
      startDateTime.setHours(parseInt(startHour), parseInt(startMin), 0);

      const endDateTime = new Date(currentDate);
      const [endHour, endMin] = event.endTime.split(':');
      endDateTime.setHours(parseInt(endHour), parseInt(endMin), 0);

      // Format as YYYYMMDDTHHMMSS
      const formatICS = (d: Date) => {
        const year = d.getFullYear();
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const day = d.getDate().toString().padStart(2, '0');
        const hour = d.getHours().toString().padStart(2, '0');
        const min = d.getMinutes().toString().padStart(2, '0');
        const sec = d.getSeconds().toString().padStart(2, '0');
        return `${year}${month}${day}T${hour}${min}${sec}`;
      };

      const uid = `sf-sweep-${event.streetName.replace(/\s/g, '-')}-${formatICS(startDateTime)}@autopilotamerica.com`;

      icsEvents.push(`BEGIN:VEVENT
UID:${uid}
DTSTAMP:${formatICS(new Date())}
DTSTART:${formatICS(startDateTime)}
DTEND:${formatICS(endDateTime)}
SUMMARY:Move Car - Street Cleaning
DESCRIPTION:Street cleaning on ${event.streetName}${event.blockSide ? ` (${event.blockSide} side)` : ''}\\n\\nMake sure to move your car before ${event.startTime} to avoid a ticket!\\n\\nPowered by Autopilot America
LOCATION:${event.streetName}, San Francisco, CA
STATUS:CONFIRMED
SEQUENCE:0
BEGIN:VALARM
TRIGGER:-PT12H
DESCRIPTION:Street cleaning tomorrow on ${event.streetName}
ACTION:DISPLAY
END:VALARM
END:VEVENT`);

      // Find next occurrence (move forward by 7 days or to next scheduled week)
      currentDate.setDate(currentDate.getDate() + 7);
    }
  }

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Autopilot America//SF Street Sweeping//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:SF Street Sweeping - ${address}
X-WR-TIMEZONE:America/Los_Angeles
X-WR-CALDESC:Street sweeping schedule for ${address} in San Francisco
${icsEvents.join('\n')}
END:VCALENDAR`;

  // Create data URL
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  return URL.createObjectURL(blob);
}
