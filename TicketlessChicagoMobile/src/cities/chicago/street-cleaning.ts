/**
 * Chicago Street Cleaning Configuration
 *
 * REFERENCE IMPLEMENTATION
 *
 * Data Source: Chicago Data Portal
 * https://data.cityofchicago.org/
 *
 * Chicago street cleaning runs April through November.
 * Schedules are based on ward and posted signs.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const chicagoStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'chicago',
  enabled: true,
  dataSource: {
    type: 'api',
    url: 'https://data.cityofchicago.org/resource/wqdh-9gek.json',
    updateFrequency: 'weekly',
    documentation: 'https://data.cityofchicago.org/Sanitation/Street-Sweeping-Schedule/wqdh-9gek',
  },
  scheduleFormat: {
    usesOddEven: false,
    usesDayOfWeek: true,
    usesWeekOfMonth: true,
    usesDateRanges: true, // April - November
    usesTimeRanges: true,
    usesZones: true, // By ward
    usesRoutes: false,
  },
  seasonalRules: {
    activeSeason: {
      startMonth: 4, // April
      startDay: 1,
      endMonth: 11, // November
      endDay: 30,
    },
    suspendedMonths: [12, 1, 2, 3], // December - March
    winterSuspension: true,
    notes: 'Street cleaning typically runs April 1 through November 30',
  },
  holidayRules: {
    observedHolidays: [
      'New Year\'s Day',
      'Memorial Day',
      'Independence Day',
      'Labor Day',
      'Thanksgiving Day',
      'Christmas Day',
    ],
    makeupPolicy: 'none',
    notes: 'No street cleaning on major holidays. No makeup days.',
  },
  notificationDefaults: {
    hoursBeforeAlert: 12,
    smsEnabled: true,
    emailEnabled: true,
    pushEnabled: true,
  },
};

/**
 * Parse Chicago street cleaning data from API response
 */
export function parseChicagoStreetCleaning(apiData: any[]): StreetCleaningSchedule[] {
  return apiData.map((item, index) => ({
    id: `chicago-${index}`,
    cityId: 'chicago',
    streetName: item.street_name || '',
    blockRange: item.block_range,
    side: mapSide(item.side),
    dayOfWeek: parseDayOfWeek(item.day),
    weekOfMonth: parseWeekOfMonth(item.week),
    startTime: item.start_time || '09:00',
    endTime: item.end_time || '15:00',
    zone: item.ward,
    seasonalOnly: true,
  }));
}

function mapSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
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

function parseDayOfWeek(day: string): number[] {
  const dayMap: Record<string, number> = {
    'SUNDAY': 0,
    'MONDAY': 1,
    'TUESDAY': 2,
    'WEDNESDAY': 3,
    'THURSDAY': 4,
    'FRIDAY': 5,
    'SATURDAY': 6,
  };
  return [dayMap[day?.toUpperCase()] ?? 1];
}

function parseWeekOfMonth(week: string): number[] {
  if (!week) return [1, 2, 3, 4];
  const weekNum = parseInt(week, 10);
  return isNaN(weekNum) ? [1, 2, 3, 4] : [weekNum];
}

export default chicagoStreetCleaningConfig;
