/**
 * San Francisco Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - SF Open Data: https://data.sfgov.org/City-Infrastructure/Street-Sweeping-Schedule/yhqp-riqs
 * - SFMTA: https://www.sfmta.com/getting-around/drive-park/street-cleaning
 *
 * SF street sweeping runs year-round.
 * Each block has specific day/time based on posted signs.
 * Uses "tow-away" enforcement on some streets.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const sfStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'san-francisco',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'api',
    url: 'https://data.sfgov.org/resource/yhqp-riqs.json',
    updateFrequency: 'monthly',
    documentation: 'https://data.sfgov.org/City-Infrastructure/Street-Sweeping-Schedule/yhqp-riqs',
  },
  scheduleFormat: {
    usesOddEven: true,
    usesDayOfWeek: true,
    usesWeekOfMonth: true, // 1st, 2nd, 3rd, 4th week patterns
    usesDateRanges: false, // Year-round
    usesTimeRanges: true,
    usesZones: false,
    usesRoutes: true, // Route numbers in data
  },
  seasonalRules: {
    activeSeason: {
      startMonth: 1,
      startDay: 1,
      endMonth: 12,
      endDay: 31,
    },
    suspendedMonths: [], // Year-round
    winterSuspension: false,
    notes: 'SF street sweeping runs year-round. Check posted signs for specific schedules.',
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
 * Parse SF street sweeping data from Open Data API
 */
export function parseSFStreetCleaning(apiData: any[]): StreetCleaningSchedule[] {
  return apiData.map((item, index) => ({
    id: `sf-${item.cnn || index}`,
    cityId: 'san-francisco',
    streetName: item.streetname || item.full_street_name || '',
    blockRange: item.limits || undefined,
    side: mapSFSide(item.side),
    dayOfWeek: parseSFDay(item.weekday),
    weekOfMonth: parseSFWeekOfMonth(item.week1ofmonth, item.week2ofmonth, item.week3ofmonth, item.week4ofmonth),
    startTime: item.fromhour || '08:00',
    endTime: item.tohour || '10:00',
    route: item.route || undefined,
    seasonalOnly: false,
    geometry: item.the_geom ? JSON.parse(item.the_geom) : undefined,
    towing: item.towawayschedule === 'Y', // SF has tow-away zones
  }));
}

function mapSFSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
  const sideMap: Record<string, any> = {
    'North': 'north',
    'South': 'south',
    'East': 'east',
    'West': 'west',
    'N': 'north',
    'S': 'south',
    'E': 'east',
    'W': 'west',
  };
  return sideMap[side] || 'both';
}

function parseSFDay(day: string): number[] {
  const dayMap: Record<string, number> = {
    'Sun': 0, 'Sunday': 0,
    'Mon': 1, 'Monday': 1,
    'Tue': 2, 'Tuesday': 2,
    'Wed': 3, 'Wednesday': 3,
    'Thu': 4, 'Thursday': 4,
    'Fri': 5, 'Friday': 5,
    'Sat': 6, 'Saturday': 6,
  };
  return [dayMap[day] ?? 1];
}

function parseSFWeekOfMonth(w1: string, w2: string, w3: string, w4: string): number[] {
  const result: number[] = [];
  if (w1 === 'Y') result.push(1);
  if (w2 === 'Y') result.push(2);
  if (w3 === 'Y') result.push(3);
  if (w4 === 'Y') result.push(4);
  return result.length > 0 ? result : [1, 2, 3, 4];
}

export default sfStreetCleaningConfig;
