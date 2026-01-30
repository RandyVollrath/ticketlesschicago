/**
 * Denver City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Denver Open Data: https://www.denvergov.org/opendata
 * - DPW: https://www.denvergov.org/Government/Agencies-Departments-Offices/Department-of-Transportation-Infrastructure
 */

import { CityConfig, AppCityConfig } from '../types';

export const denverConfig: CityConfig = {
  cityId: 'denver',
  cityName: 'Denver',
  state: 'Colorado',
  stateAbbrev: 'CO',
  timezone: 'America/Denver',
  enabled: false, // DISABLED BY DEFAULT
  population: 715522,
  mapBounds: {
    north: 39.9142,
    south: 39.6143,
    east: -104.6002,
    west: -105.1098,
    center: {
      latitude: 39.7392,
      longitude: -104.9903,
    },
  },
  parkingAuthority: {
    name: 'City and County of Denver - Parking Operations',
    website: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Department-of-Transportation-Infrastructure/Parking',
    phone: '720-913-1600',
  },
};

export const denverAppConfig: AppCityConfig = {
  cityId: 'denver',
  enabled: false,
  mapBounds: denverConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Neighborhood parking permits
    timeRestrictions: true,
    snowRoutes: true, // Denver has snow routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Sweeping',
      parkingTicket: 'Parking Citation',
      meterParking: 'Metered Parking',
      permitZone: 'Neighborhood Parking Permit',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default denverConfig;
