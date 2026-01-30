/**
 * NYC Street Cleaning (Alternate Side Parking) Configuration
 *
 * DISABLED BY DEFAULT
 *
 * NYC uses "Alternate Side Parking" (ASP) for street cleaning.
 * Vehicles must move to allow street sweepers to pass.
 *
 * Data Sources:
 * - NYC Open Data: https://data.cityofnewyork.us/Transportation/Parking-Regulation-Locations-and-Signs/xswq-wnv9
 * - NYC DOT ASP Calendar: https://www.nyc.gov/html/dot/html/motorist/alternate-side-parking.shtml
 * - ASP Suspension API: https://data.cityofnewyork.us/City-Government/Alternate-Side-Parking-Suspensions/vr8p-8shw
 *
 * Key Differences from Chicago:
 * - Called "Alternate Side Parking" not "Street Cleaning"
 * - ASP is suspended on many holidays (30+ per year)
 * - ASP suspension announcements via @ABORNSNYC on Twitter
 * - Signs show specific days/times (e.g., "No Parking 8-9:30AM Mon & Thu")
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const nycStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'nyc',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'api',
    url: 'https://data.cityofnewyork.us/resource/xswq-wnv9.json',
    updateFrequency: 'daily',
    documentation: 'https://data.cityofnewyork.us/Transportation/Parking-Regulation-Locations-and-Signs/xswq-wnv9',
  },
  scheduleFormat: {
    usesOddEven: true, // Alternate sides of street
    usesDayOfWeek: true,
    usesWeekOfMonth: false, // Usually just day of week
    usesDateRanges: false, // Year-round with suspensions
    usesTimeRanges: true, // Usually 1.5 hour windows
    usesZones: false,
    usesRoutes: false,
  },
  seasonalRules: {
    activeSeason: {
      startMonth: 1,
      startDay: 1,
      endMonth: 12,
      endDay: 31,
    },
    suspendedMonths: [], // Year-round, but many holiday suspensions
    winterSuspension: false, // No winter suspension, just holiday suspensions
    notes: 'NYC ASP runs year-round but is suspended on 30+ holidays per year. Check @NABORNSNYC for daily updates.',
  },
  holidayRules: {
    observedHolidays: [
      // Major holidays
      "New Year's Day",
      'Martin Luther King Jr. Day',
      "Lincoln's Birthday",
      "Presidents' Day",
      'Ash Wednesday',
      'Purim',
      'Holy Thursday',
      'Good Friday',
      'Passover (First two days)',
      'Passover (Last two days)',
      'Easter Sunday',
      'Solemnity of the Ascension',
      'Memorial Day',
      'Shavuot (Two days)',
      'Juneteenth',
      'Independence Day',
      'Feast of the Assumption',
      'Labor Day',
      'Rosh Hashanah (Two days)',
      'Yom Kippur',
      'Sukkot (Two days)',
      'Shemini Atzeret/Simchat Torah',
      'Columbus Day',
      'Diwali',
      "All Saints' Day",
      'Election Day',
      'Veterans Day',
      'Thanksgiving Day',
      'Immaculate Conception',
      'Christmas Day',
    ],
    makeupPolicy: 'none',
    notes: 'NYC has extensive holiday suspensions. Always check @NABORNSNYC Twitter or 311 before moving vehicle.',
  },
  notificationDefaults: {
    hoursBeforeAlert: 12,
    smsEnabled: true,
    emailEnabled: true,
    pushEnabled: true,
  },
};

/**
 * Parse NYC parking regulation data from Open Data API
 */
export function parseNYCStreetCleaning(apiData: any[]): StreetCleaningSchedule[] {
  return apiData
    .filter(item => item.sign_description?.toLowerCase().includes('broom') ||
                    item.sign_description?.toLowerCase().includes('sweeping') ||
                    item.sign_description?.toLowerCase().includes('no parking'))
    .map((item, index) => {
      const parsed = parseNYCSign(item.sign_description);
      return {
        id: `nyc-${item.sign_id || index}`,
        cityId: 'nyc',
        streetName: item.main_street || item.street_name || '',
        blockRange: item.from_street && item.to_street
          ? `${item.from_street} to ${item.to_street}`
          : undefined,
        side: mapNYCSide(item.side_of_street),
        dayOfWeek: parsed.days,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
        zone: item.borough,
        seasonalOnly: false,
        geometry: item.the_geom ? JSON.parse(item.the_geom) : undefined,
      };
    });
}

/**
 * Parse NYC sign description to extract schedule
 * Example: "NO PARKING 8AM-9:30AM MON & THUR"
 */
function parseNYCSign(description: string): {
  days: number[];
  startTime: string;
  endTime: string;
} {
  const defaults = { days: [1], startTime: '08:00', endTime: '09:30' };

  if (!description) return defaults;

  const desc = description.toUpperCase();

  // Parse days
  const days: number[] = [];
  if (desc.includes('MON')) days.push(1);
  if (desc.includes('TUE')) days.push(2);
  if (desc.includes('WED')) days.push(3);
  if (desc.includes('THU')) days.push(4);
  if (desc.includes('FRI')) days.push(5);
  if (desc.includes('SAT')) days.push(6);
  if (desc.includes('SUN')) days.push(0);

  // Parse time range (e.g., "8AM-9:30AM" or "8:00AM-9:30AM")
  const timeMatch = desc.match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*-\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)/i);

  let startTime = '08:00';
  let endTime = '09:30';

  if (timeMatch) {
    const startHour = parseInt(timeMatch[1]);
    const startMin = timeMatch[2] || '00';
    const startPeriod = timeMatch[3];
    const endHour = parseInt(timeMatch[4]);
    const endMin = timeMatch[5] || '00';
    const endPeriod = timeMatch[6];

    const start24 = to24Hour(startHour, startPeriod);
    const end24 = to24Hour(endHour, endPeriod);

    startTime = `${start24.toString().padStart(2, '0')}:${startMin}`;
    endTime = `${end24.toString().padStart(2, '0')}:${endMin}`;
  }

  return {
    days: days.length > 0 ? days : [1],
    startTime,
    endTime,
  };
}

function to24Hour(hour: number, period: string): number {
  if (period.toUpperCase() === 'AM') {
    return hour === 12 ? 0 : hour;
  } else {
    return hour === 12 ? 12 : hour + 12;
  }
}

function mapNYCSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
  const sideMap: Record<string, any> = {
    'N': 'north',
    'S': 'south',
    'E': 'east',
    'W': 'west',
    'NORTH': 'north',
    'SOUTH': 'south',
    'EAST': 'east',
    'WEST': 'west',
    'ODD': 'odd',
    'EVEN': 'even',
  };
  return sideMap[side?.toUpperCase()] || 'both';
}

/**
 * Check if ASP is suspended today
 * Uses NYC 311 ASP Suspension API
 */
export async function checkNYCASPSuspension(date: Date): Promise<{
  suspended: boolean;
  reason?: string;
}> {
  // This would call: https://data.cityofnewyork.us/resource/vr8p-8shw.json
  // For now, return a placeholder
  return {
    suspended: false,
  };
}

export default nycStreetCleaningConfig;
