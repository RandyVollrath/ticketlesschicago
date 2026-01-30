/**
 * Seattle Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Seattle Open Data: https://data.seattle.gov/
 * - SDOT: https://www.seattle.gov/transportation/projects-and-programs/programs/maintenance-and-paving/street-cleaning
 *
 * Seattle street sweeping runs year-round in most areas.
 * Some residential areas have seasonal schedules.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const seattleStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'seattle',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'api',
    url: 'https://data.seattle.gov/resource/street-sweeping.json',
    updateFrequency: 'monthly',
    documentation: 'https://data.seattle.gov/',
  },
  scheduleFormat: {
    usesOddEven: true,
    usesDayOfWeek: true,
    usesWeekOfMonth: true,
    usesDateRanges: false, // Mostly year-round
    usesTimeRanges: true,
    usesZones: true, // By neighborhood
    usesRoutes: true,
  },
  seasonalRules: {
    activeSeason: {
      startMonth: 1,
      startDay: 1,
      endMonth: 12,
      endDay: 31,
    },
    suspendedMonths: [], // Year-round in most areas
    winterSuspension: false,
    notes: 'Seattle street sweeping runs year-round. Check posted signs for specific schedules.',
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
      'Day After Thanksgiving',
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
 * Parse Seattle street sweeping data
 */
export function parseSeattleStreetCleaning(data: any[]): StreetCleaningSchedule[] {
  return data.map((item, index) => ({
    id: `seattle-${item.objectid || index}`,
    cityId: 'seattle',
    streetName: item.street_name || item.streetname || '',
    blockRange: item.block_range || undefined,
    side: mapSeattleSide(item.side),
    dayOfWeek: parseSeattleDay(item.day_of_week || item.weekday),
    weekOfMonth: parseSeattleWeekOfMonth(item.week_of_month),
    startTime: item.start_time || '08:00',
    endTime: item.end_time || '11:00',
    zone: item.neighborhood || item.district,
    route: item.route || undefined,
    seasonalOnly: false,
    geometry: item.the_geom ? JSON.parse(item.the_geom) : undefined,
  }));
}

function mapSeattleSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
  const sideMap: Record<string, any> = {
    'N': 'north',
    'S': 'south',
    'E': 'east',
    'W': 'west',
    'NORTH': 'north',
    'SOUTH': 'south',
    'EAST': 'east',
    'WEST': 'west',
  };
  return sideMap[side?.toUpperCase()] || 'both';
}

function parseSeattleDay(day: string): number[] {
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

function parseSeattleWeekOfMonth(week: string): number[] {
  if (!week) return [1, 2, 3, 4];

  const weekLower = week.toLowerCase();
  if (weekLower.includes('1') && weekLower.includes('3')) return [1, 3];
  if (weekLower.includes('2') && weekLower.includes('4')) return [2, 4];

  const num = parseInt(week);
  if (!isNaN(num) && num >= 1 && num <= 4) return [num];

  return [1, 2, 3, 4];
}

export default seattleStreetCleaningConfig;
