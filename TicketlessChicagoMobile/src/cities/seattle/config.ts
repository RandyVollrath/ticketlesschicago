/**
 * Seattle City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Seattle Open Data: https://data.seattle.gov/
 * - SDOT: https://www.seattle.gov/transportation
 */

import { CityConfig, AppCityConfig } from '../types';

export const seattleConfig: CityConfig = {
  cityId: 'seattle',
  cityName: 'Seattle',
  state: 'Washington',
  stateAbbrev: 'WA',
  timezone: 'America/Los_Angeles',
  enabled: false, // DISABLED BY DEFAULT
  population: 737015,
  mapBounds: {
    north: 47.7341,
    south: 47.4919,
    east: -122.2244,
    west: -122.4596,
    center: {
      latitude: 47.6062,
      longitude: -122.3321,
    },
  },
  parkingAuthority: {
    name: 'Seattle Municipal Court',
    website: 'https://www.seattle.gov/courts/tickets-and-payments/parking-tickets',
    phone: '206-233-7000',
  },
};

export const seattleAppConfig: AppCityConfig = {
  cityId: 'seattle',
  enabled: false,
  mapBounds: seattleConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Restricted Parking Zones (RPZ)
    timeRestrictions: true,
    snowRoutes: false, // Seattle rarely has snow routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Cleaning',
      parkingTicket: 'Parking Infraction',
      meterParking: 'Metered Parking',
      permitZone: 'Restricted Parking Zone (RPZ)',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default seattleConfig;
