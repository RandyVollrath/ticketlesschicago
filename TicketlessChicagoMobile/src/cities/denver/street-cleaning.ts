/**
 * Denver Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Denver Open Data: https://www.denvergov.org/opendata
 * - Street Sweeping: https://www.denvergov.org/Government/Agencies-Departments-Offices/Department-of-Transportation-Infrastructure/Programs-Services/Street-Sweeping
 *
 * Denver street sweeping runs April through November.
 * Each block has specific day/time.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const denverStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'denver',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'geojson',
    url: 'https://www.denvergov.org/opendata/dataset/street-sweeping',
    updateFrequency: 'annually',
    documentation: 'https://www.denvergov.org/opendata',
  },
  scheduleFormat: {
    usesOddEven: true,
    usesDayOfWeek: true,
    usesWeekOfMonth: true,
    usesDateRanges: true, // April through November
    usesTimeRanges: true,
    usesZones: true, // By neighborhood
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
    notes: 'Denver street sweeping runs April through November. No sweeping December through March.',
  },
  holidayRules: {
    observedHolidays: [
      "New Year's Day",
      'Martin Luther King Jr. Day',
      "Presidents' Day",
      'Cesar Chavez Day',
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
 * Parse Denver street sweeping data
 */
export function parseDenverStreetCleaning(data: any[]): StreetCleaningSchedule[] {
  return data.map((item, index) => ({
    id: `denver-${item.objectid || index}`,
    cityId: 'denver',
    streetName: item.street_name || item.streetname || '',
    blockRange: item.block_range || undefined,
    side: mapDenverSide(item.side),
    dayOfWeek: parseDenverDay(item.day_of_week || item.weekday),
    weekOfMonth: parseDenverWeekOfMonth(item.week_of_month),
    startTime: item.start_time || '08:00',
    endTime: item.end_time || '12:00',
    zone: item.neighborhood || item.district,
    route: item.route || undefined,
    seasonalOnly: true,
    seasonStart: { month: 4, day: 1 },
    seasonEnd: { month: 11, day: 30 },
    geometry: item.the_geom ? JSON.parse(item.the_geom) : undefined,
  }));
}

function mapDenverSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
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

function parseDenverDay(day: string): number[] {
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

function parseDenverWeekOfMonth(week: string): number[] {
  if (!week) return [1, 2, 3, 4];

  const weekLower = week.toLowerCase();
  if (weekLower.includes('1') && weekLower.includes('3')) return [1, 3];
  if (weekLower.includes('2') && weekLower.includes('4')) return [2, 4];

  const num = parseInt(week);
  if (!isNaN(num) && num >= 1 && num <= 4) return [num];

  return [1, 2, 3, 4];
}

export default denverStreetCleaningConfig;
