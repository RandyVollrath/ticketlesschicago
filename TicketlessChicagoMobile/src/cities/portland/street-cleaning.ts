/**
 * Portland Street Cleaning Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Portland Open Data: https://gis-pdx.opendata.arcgis.com/
 * - PBOT Street Sweeping: https://www.portland.gov/transportation/maintenance/street-sweeping
 *
 * Portland street sweeping runs year-round in most areas.
 * Each block has specific day/time.
 */

import {
  CityStreetCleaningConfig,
  StreetCleaningSchedule,
} from '../types';

export const portlandStreetCleaningConfig: CityStreetCleaningConfig = {
  cityId: 'portland',
  enabled: false, // DISABLED BY DEFAULT
  dataSource: {
    type: 'geojson',
    url: 'https://gis-pdx.opendata.arcgis.com/datasets/street-sweeping',
    updateFrequency: 'monthly',
    documentation: 'https://gis-pdx.opendata.arcgis.com/',
  },
  scheduleFormat: {
    usesOddEven: true,
    usesDayOfWeek: true,
    usesWeekOfMonth: true,
    usesDateRanges: false, // Year-round in most areas
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
    suspendedMonths: [], // Year-round
    winterSuspension: false,
    notes: 'Portland street sweeping runs year-round. Check posted signs for specific schedules.',
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
 * Parse Portland street sweeping data
 */
export function parsePortlandStreetCleaning(data: any[]): StreetCleaningSchedule[] {
  return data.map((item, index) => ({
    id: `portland-${item.objectid || index}`,
    cityId: 'portland',
    streetName: item.street_name || item.streetname || '',
    blockRange: item.block_range || undefined,
    side: mapPortlandSide(item.side),
    dayOfWeek: parsePortlandDay(item.day_of_week || item.weekday),
    weekOfMonth: parsePortlandWeekOfMonth(item.week_of_month),
    startTime: item.start_time || '08:00',
    endTime: item.end_time || '17:00',
    zone: item.neighborhood || item.district,
    route: item.route || undefined,
    seasonalOnly: false,
    geometry: item.the_geom ? JSON.parse(item.the_geom) : undefined,
  }));
}

function mapPortlandSide(side: string): 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both' {
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

function parsePortlandDay(day: string): number[] {
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

function parsePortlandWeekOfMonth(week: string): number[] {
  if (!week) return [1, 2, 3, 4];

  const weekLower = week.toLowerCase();
  if (weekLower.includes('1') && weekLower.includes('3')) return [1, 3];
  if (weekLower.includes('2') && weekLower.includes('4')) return [2, 4];

  const num = parseInt(week);
  if (!isNaN(num) && num >= 1 && num <= 4) return [num];

  return [1, 2, 3, 4];
}

export default portlandStreetCleaningConfig;
