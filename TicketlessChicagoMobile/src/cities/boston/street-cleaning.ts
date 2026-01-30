/**
 * Boston Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Boston Open Data: https://data.boston.gov/dataset/street-sweeping-schedules
 * - PWD Street Sweeping: https://www.boston.gov/departments/public-works/street-sweeping
 *
 * Boston street sweeping runs April 1 - November 30.
 * Each street has designated day/time based on neighborhood.
 * Snow emergency routes have different rules.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const bostonStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'boston',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'geojson',
    url: 'https://data.boston.gov/dataset/street-sweeping-schedules',
    updateFrequency: 'annually',
    documentation: 'https://data.boston.gov/dataset/street-sweeping-schedules',
  },
  scheduleFormat: {
    usesOddEven: true, // Different sides on different days
    usesDayOfWeek: true,
    usesWeekOfMonth: true, // 1st/3rd or 2nd/4th patterns
    usesDateRanges: true, // April 1 - November 30
    usesTimeRanges: true,
    usesZones: true, // By neighborhood
    usesRoutes: false,
  },
  seasonalRules: {
    activeSeason: {
      startMonth: 4,
      startDay: 1,
      endMonth: 11,
      endDay: 30,
    },
    suspendedMonths: [12, 1, 2, 3], // December through March
    winterSuspension: true,
    notes: 'Boston street sweeping runs April 1 through November 30. No sweeping December through March.',
  },
  holidayRules: {
    observedHolidays: [
      "New Year's Day",
      'Martin Luther King Jr. Day',
      "Presidents' Day",
      'Patriots Day', // Massachusetts specific
      'Memorial Day',
      'Juneteenth',
      'Independence Day',
      'Labor Day',
      'Columbus Day',
      'Veterans Day',
      'Thanksgiving Day',
      'Christmas Day',
    ],
    makeupPolicy: 'none',
    notes: 'No street sweeping on observed City holidays.',
  },
  notificationDefaults: {
    hoursBeforeAlert: 12,
    smsEnabled: true,
    emailEnabled: true,
    pushEnabled: true,
  },
};

/**
 * Parse Boston street sweeping data
 */
export function parseBostonStreetCleaning(data: any[]): StreetCleaningSchedule[] {
  return data.map((item, index) => ({
    id: `boston-${item.objectid || index}`,
    cityId: 'boston',
    streetName: item.full_street_name || item.street_name || '',
    blockRange: item.low_num && item.high_num
      ? `${item.low_num}-${item.high_num}`
      : undefined,
    side: mapBostonSide(item.side),
    dayOfWeek: parseBostonDay(item.day_of_week),
    weekOfMonth: parseBostonWeekOfMonth(item.week),
    startTime: item.from_time || '08:00',
    endTime: item.to_time || '12:00',
    zone: item.neighborhood || item.district,
    seasonalOnly: true,
    seasonStart: { month: 4, day: 1 },
    seasonEnd: { month: 11, day: 30 },
    geometry: item.geo_shape ? JSON.parse(item.geo_shape) : undefined,
  }));
}

function mapBostonSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
  const sideMap: Record<string, any> = {
    'N': 'north',
    'S': 'south',
    'E': 'east',
    'W': 'west',
    'ODD': 'odd',
    'EVEN': 'even',
  };
  return sideMap[side?.toUpperCase()] || 'both';
}

function parseBostonDay(day: string): number[] {
  const dayMap: Record<string, number> = {
    'SUNDAY': 0, 'SUN': 0,
    'MONDAY': 1, 'MON': 1,
    'TUESDAY': 2, 'TUE': 2,
    'WEDNESDAY': 3, 'WED': 3,
    'THURSDAY': 4, 'THU': 4,
    'FRIDAY': 5, 'FRI': 5,
    'SATURDAY': 6, 'SAT': 6,
  };
  return [dayMap[day?.toUpperCase()] ?? 1];
}

function parseBostonWeekOfMonth(week: string): number[] {
  if (!week) return [1, 2, 3, 4];

  const weekLower = week.toLowerCase();
  if (weekLower.includes('1st') && weekLower.includes('3rd')) return [1, 3];
  if (weekLower.includes('2nd') && weekLower.includes('4th')) return [2, 4];
  if (weekLower.includes('1st')) return [1];
  if (weekLower.includes('2nd')) return [2];
  if (weekLower.includes('3rd')) return [3];
  if (weekLower.includes('4th')) return [4];

  return [1, 2, 3, 4];
}

export default bostonStreetCleaningConfig;
