/**
 * Minneapolis City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Minneapolis Open Data: https://opendata.minneapolismn.gov/
 * - Public Works: https://www.minneapolismn.gov/government/departments/public-works/
 */

import { CityConfig, AppCityConfig } from '../types';

export const minneapolisConfig: CityConfig = {
  cityId: 'minneapolis',
  cityName: 'Minneapolis',
  state: 'Minnesota',
  stateAbbrev: 'MN',
  timezone: 'America/Chicago',
  enabled: false, // DISABLED BY DEFAULT
  population: 429954,
  mapBounds: {
    north: 45.0512,
    south: 44.8900,
    east: -93.1936,
    west: -93.3293,
    center: {
      latitude: 44.9778,
      longitude: -93.2650,
    },
  },
  parkingAuthority: {
    name: 'City of Minneapolis - Parking Services',
    website: 'https://www.minneapolismn.gov/government/departments/regulatory-services/parking-traffic-control/',
    phone: '612-673-2411',
  },
};

export const minneapolisAppConfig: AppCityConfig = {
  cityId: 'minneapolis',
  enabled: false,
  mapBounds: minneapolisConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Residential parking permits
    timeRestrictions: true,
    snowRoutes: true, // Minneapolis has snow emergency routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Sweeping',
      parkingTicket: 'Parking Citation',
      meterParking: 'Metered Parking',
      permitZone: 'Residential Parking Permit',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default minneapolisConfig;
