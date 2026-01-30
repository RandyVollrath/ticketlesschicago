/**
 * Los Angeles Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - LA Open Data: https://data.lacity.org/
 * - LA Sanitation: https://www.lacitysan.org/san/faces/home/portal/s-lsh-wwd/s-lsh-wwd-s/s-lsh-wwd-s-c
 * - GeoHub: https://geohub.lacity.org/datasets/city-street-sweeping-schedule
 *
 * LA street sweeping runs year-round (no seasonal suspension).
 * Each block has specific day/time based on posted signs.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const laStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'los-angeles',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'geojson',
    url: 'https://geohub.lacity.org/datasets/city-street-sweeping-schedule/explore',
    updateFrequency: 'monthly',
    documentation: 'https://data.lacity.org/City-Infrastructure-Service-Requests/Street-Sweeping-Schedule/u9m2-2q5n',
  },
  scheduleFormat: {
    usesOddEven: true, // Both sides of street on different days
    usesDayOfWeek: true,
    usesWeekOfMonth: true, // 1st Monday, 2nd Tuesday, etc.
    usesDateRanges: false, // Year-round
    usesTimeRanges: true, // Usually 2-hour windows
    usesZones: false,
    usesRoutes: true, // Routes identified in data
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
    notes: 'LA street sweeping runs year-round. Check posted signs for specific schedules.',
  },
  holidayRules: {
    observedHolidays: [
      "New Year's Day",
      'Martin Luther King Jr. Day',
      "Presidents' Day",
      'Cesar Chavez Day',
      'Memorial Day',
      'Independence Day',
      'Labor Day',
      'Veterans Day',
      'Thanksgiving Day',
      'Day After Thanksgiving',
      'Christmas Day',
    ],
    makeupPolicy: 'none',
    notes: 'No street sweeping on observed City holidays. Check City website for annual calendar.',
  },
  notificationDefaults: {
    hoursBeforeAlert: 12,
    smsEnabled: true,
    emailEnabled: true,
    pushEnabled: true,
  },
};

/**
 * Parse LA street sweeping data from GeoJSON
 */
export function parseLAStreetCleaning(geoData: any): StreetCleaningSchedule[] {
  if (!geoData?.features) return [];

  return geoData.features.map((feature: any, index: number) => {
    const props = feature.properties || {};
    return {
      id: `la-${props.OBJECTID || index}`,
      cityId: 'los-angeles',
      streetName: props.STREETNAME || props.FULL_STREET_NAME || '',
      blockRange: props.BLOCK_RANGE || undefined,
      side: mapLASide(props.SIDE),
      dayOfWeek: parseLADayOfWeek(props.WEEKDAY),
      weekOfMonth: parseLAWeekOfMonth(props.WEEK1, props.WEEK2, props.WEEK3, props.WEEK4, props.WEEK5),
      startTime: props.START_TIME || '08:00',
      endTime: props.END_TIME || '10:00',
      route: props.ROUTE || undefined,
      seasonalOnly: false,
      geometry: feature.geometry,
    };
  });
}

function mapLASide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
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

function parseLADayOfWeek(day: string): number[] {
  const dayMap: Record<string, number> = {
    'SUN': 0, 'SUNDAY': 0,
    'MON': 1, 'MONDAY': 1,
    'TUE': 2, 'TUESDAY': 2,
    'WED': 3, 'WEDNESDAY': 3,
    'THU': 4, 'THURSDAY': 4,
    'FRI': 5, 'FRIDAY': 5,
    'SAT': 6, 'SATURDAY': 6,
  };
  return [dayMap[day?.toUpperCase()] ?? 1];
}

function parseLAWeekOfMonth(...weeks: string[]): number[] {
  const result: number[] = [];
  weeks.forEach((week, index) => {
    if (week === 'Y' || week === 'YES' || week === '1') {
      result.push(index + 1);
    }
  });
  return result.length > 0 ? result : [1, 2, 3, 4];
}

export default laStreetCleaningConfig;
