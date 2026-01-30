/**
 * New York City Configuration
 *
 * NYC includes all 5 boroughs: Manhattan, Brooklyn, Queens, Bronx, Staten Island
 * DISABLED BY DEFAULT - hidden from users until manually enabled
 *
 * Data Sources:
 * - NYC Open Data: https://data.cityofnewyork.us/
 * - NYC DOT: https://www.nyc.gov/html/dot/html/motorist/alternate-side-parking.shtml
 */

import { CityConfig, AppCityConfig } from '../types';

export const nycConfig: CityConfig = {
  cityId: 'nyc',
  cityName: 'New York City',
  state: 'New York',
  stateAbbrev: 'NY',
  timezone: 'America/New_York',
  enabled: false, // DISABLED BY DEFAULT
  population: 8336817,
  mapBounds: {
    north: 40.917577,
    south: 40.477399,
    east: -73.700272,
    west: -74.259090,
    center: {
      latitude: 40.7128,
      longitude: -74.0060,
    },
  },
  parkingAuthority: {
    name: 'NYC Department of Finance - Parking Violations',
    website: 'https://www.nyc.gov/site/finance/vehicles/services-payments.page',
    phone: '311',
  },
};

export const nycAppConfig: AppCityConfig = {
  cityId: 'nyc',
  enabled: false, // DISABLED BY DEFAULT
  mapBounds: nycConfig.mapBounds,
  defaultZoom: 12,
  parkingDataLayers: {
    streetCleaning: true, // ASP - Alternate Side Parking
    meters: true, // Muni-Meters
    permits: true, // Residential permits in some areas
    timeRestrictions: true,
    snowRoutes: true,
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A', // NYC doesn't have city stickers
      streetCleaning: 'Alternate Side Parking',
      parkingTicket: 'Parking Violation',
      meterParking: 'Muni-Meter Parking',
      permitZone: 'Residential Parking Permit',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

// NYC Boroughs for more granular configuration
export const nycBoroughs = [
  { id: 'manhattan', name: 'Manhattan', code: 'MN' },
  { id: 'brooklyn', name: 'Brooklyn', code: 'BK' },
  { id: 'queens', name: 'Queens', code: 'QN' },
  { id: 'bronx', name: 'Bronx', code: 'BX' },
  { id: 'staten-island', name: 'Staten Island', code: 'SI' },
];

export default nycConfig;
