/**
 * San Francisco City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - SF Open Data: https://datasf.org/opendata/
 * - SFMTA: https://www.sfmta.com/
 */

import { CityConfig, AppCityConfig } from '../types';

export const sanFranciscoConfig: CityConfig = {
  cityId: 'san-francisco',
  cityName: 'San Francisco',
  state: 'California',
  stateAbbrev: 'CA',
  timezone: 'America/Los_Angeles',
  enabled: false, // DISABLED BY DEFAULT
  population: 873965,
  mapBounds: {
    north: 37.8324,
    south: 37.6398,
    east: -122.3549,
    west: -122.5146,
    center: {
      latitude: 37.7749,
      longitude: -122.4194,
    },
  },
  parkingAuthority: {
    name: 'San Francisco Municipal Transportation Agency (SFMTA)',
    website: 'https://www.sfmta.com/getting-around/drive-park/citations',
    phone: '415-701-3000',
  },
};

export const sanFranciscoAppConfig: AppCityConfig = {
  cityId: 'san-francisco',
  enabled: false,
  mapBounds: sanFranciscoConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Residential parking permits (RPP)
    timeRestrictions: true,
    snowRoutes: false, // SF doesn't have snow routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Cleaning',
      parkingTicket: 'Parking Citation',
      meterParking: 'Metered Parking',
      permitZone: 'Residential Parking Permit (RPP)',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default sanFranciscoConfig;
