/**
 * Washington DC Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - DC Open Data: https://opendata.dc.gov/datasets/street-sweeping
 * - DPW Street Sweeping: https://dpw.dc.gov/service/street-sweeping
 *
 * DC street sweeping runs April through November (seasonal).
 * Each block has specific day/time based on ward and zone.
 * DC uses both mechanical and manual sweeping.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const dcStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'washington-dc',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'geojson',
    url: 'https://opendata.dc.gov/datasets/street-sweeping',
    updateFrequency: 'annually',
    documentation: 'https://opendata.dc.gov/datasets/street-sweeping',
  },
  scheduleFormat: {
    usesOddEven: true,
    usesDayOfWeek: true,
    usesWeekOfMonth: true, // 1st/3rd or 2nd/4th patterns common
    usesDateRanges: true, // April through November
    usesTimeRanges: true,
    usesZones: true, // By ward
    usesRoutes: true,
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
    notes: 'DC street sweeping runs April 1 through November 30. No sweeping December through March.',
  },
  holidayRules: {
    observedHolidays: [
      "New Year's Day",
      'Martin Luther King Jr. Day',
      "Presidents' Day",
      'Emancipation Day', // DC-specific (April 16)
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
    notes: 'No street sweeping on observed DC holidays. Emancipation Day (April 16) is DC-specific.',
  },
  notificationDefaults: {
    hoursBeforeAlert: 12,
    smsEnabled: true,
    emailEnabled: true,
    pushEnabled: true,
  },
};

/**
 * Parse DC street sweeping data
 */
export function parseDCStreetCleaning(data: any[]): StreetCleaningSchedule[] {
  return data.map((item, index) => ({
    id: `dc-${item.objectid || index}`,
    cityId: 'washington-dc',
    streetName: item.streetname || item.full_street_name || '',
    blockRange: item.frommeasure && item.tomeasure
      ? `${item.frommeasure}-${item.tomeasure}`
      : undefined,
    side: mapDCSide(item.side),
    dayOfWeek: parseDCDay(item.day_of_week),
    weekOfMonth: parseDCWeekOfMonth(item.week_of_month),
    startTime: item.start_time || '08:00',
    endTime: item.end_time || '11:00',
    zone: item.ward || item.zone,
    route: item.route || undefined,
    seasonalOnly: true,
    seasonStart: { month: 4, day: 1 },
    seasonEnd: { month: 11, day: 30 },
    geometry: item.shape ? JSON.parse(item.shape) : undefined,
  }));
}

function mapDCSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
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

function parseDCDay(day: string): number[] {
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

function parseDCWeekOfMonth(week: string): number[] {
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

export default dcStreetCleaningConfig;
