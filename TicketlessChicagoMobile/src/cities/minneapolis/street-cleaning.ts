/**
 * Minneapolis Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Minneapolis Open Data: https://opendata.minneapolismn.gov/
 * - Street Sweeping: https://www.minneapolismn.gov/government/departments/public-works/street-sweeping/
 *
 * Minneapolis street sweeping runs April through November.
 * Heavy emphasis on snow emergency routes.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const minneapolisStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'minneapolis',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'geojson',
    url: 'https://opendata.minneapolismn.gov/datasets/street-sweeping',
    updateFrequency: 'annually',
    documentation: 'https://opendata.minneapolismn.gov/',
  },
  scheduleFormat: {
    usesOddEven: true, // Different sides on different days
    usesDayOfWeek: true,
    usesWeekOfMonth: true,
    usesDateRanges: true, // April through November
    usesTimeRanges: true,
    usesZones: true, // By neighborhood/ward
    usesRoutes: true,
  },
  seasonalRules: {
    activeSeason: {
      startMonth: 4,
      startDay: 1,
      endMonth: 11,
      endDay: 15,
    },
    suspendedMonths: [11, 12, 1, 2, 3], // Mid-November through March
    winterSuspension: true,
    notes: 'Minneapolis street sweeping runs April through mid-November. Winter months focus on snow emergency.',
  },
  holidayRules: {
    observedHolidays: [
      "New Year's Day",
      'Martin Luther King Jr. Day',
      "Presidents' Day",
      'Memorial Day',
      'Juneteenth',
      'Independence Day',
      'Labor Day',
      'Indigenous Peoples Day',
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
 * Parse Minneapolis street sweeping data
 */
export function parseMinneapolisStreetCleaning(data: any[]): StreetCleaningSchedule[] {
  return data.map((item, index) => ({
    id: `mpls-${item.objectid || index}`,
    cityId: 'minneapolis',
    streetName: item.street_name || item.streetname || '',
    blockRange: item.block_range || undefined,
    side: mapMinneapolisSide(item.side),
    dayOfWeek: parseMinneapolisDay(item.day_of_week || item.weekday),
    weekOfMonth: parseMinneapolisWeekOfMonth(item.week_of_month),
    startTime: item.start_time || '07:00',
    endTime: item.end_time || '16:00',
    zone: item.neighborhood || item.ward,
    route: item.route || undefined,
    seasonalOnly: true,
    seasonStart: { month: 4, day: 1 },
    seasonEnd: { month: 11, day: 15 },
    geometry: item.the_geom ? JSON.parse(item.the_geom) : undefined,
  }));
}

function mapMinneapolisSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
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

function parseMinneapolisDay(day: string): number[] {
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

function parseMinneapolisWeekOfMonth(week: string): number[] {
  if (!week) return [1, 2, 3, 4];

  const weekLower = week.toLowerCase();
  if (weekLower.includes('1') && weekLower.includes('3')) return [1, 3];
  if (weekLower.includes('2') && weekLower.includes('4')) return [2, 4];

  const num = parseInt(week);
  if (!isNaN(num) && num >= 1 && num <= 4) return [num];

  return [1, 2, 3, 4];
}

export default minneapolisStreetCleaningConfig;
