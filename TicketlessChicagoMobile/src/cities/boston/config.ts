/**
 * Boston City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Boston Open Data: https://data.boston.gov/
 * - BTD (Boston Transportation Department): https://www.boston.gov/departments/transportation
 */

import { CityConfig, AppCityConfig } from '../types';

export const bostonConfig: CityConfig = {
  cityId: 'boston',
  cityName: 'Boston',
  state: 'Massachusetts',
  stateAbbrev: 'MA',
  timezone: 'America/New_York',
  enabled: false, // DISABLED BY DEFAULT
  population: 675647,
  mapBounds: {
    north: 42.4009,
    south: 42.2279,
    east: -70.9234,
    west: -71.1912,
    center: {
      latitude: 42.3601,
      longitude: -71.0589,
    },
  },
  parkingAuthority: {
    name: 'City of Boston - Parking Clerk',
    website: 'https://www.boston.gov/departments/parking-clerk',
    phone: '617-635-4410',
  },
};

export const bostonAppConfig: AppCityConfig = {
  cityId: 'boston',
  enabled: false,
  mapBounds: bostonConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Resident parking permits
    timeRestrictions: true,
    snowRoutes: true, // Boston has snow emergency routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'Resident Parking Permit',
      streetCleaning: 'Street Cleaning',
      parkingTicket: 'Parking Ticket',
      meterParking: 'Metered Parking',
      permitZone: 'Resident Permit Parking',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default bostonConfig;
