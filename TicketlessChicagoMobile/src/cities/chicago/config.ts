/**
 * Chicago City Configuration
 *
 * REFERENCE IMPLEMENTATION - All other cities should follow this structure.
 * Chicago is the ONLY enabled city by default.
 */

import { CityConfig, AppCityConfig } from '../types';

export const chicagoConfig: CityConfig = {
  cityId: 'chicago',
  cityName: 'Chicago',
  state: 'Illinois',
  stateAbbrev: 'IL',
  timezone: 'America/Chicago',
  enabled: true, // Chicago is enabled
  population: 2746388,
  mapBounds: {
    north: 42.023,
    south: 41.644,
    east: -87.524,
    west: -87.940,
    center: {
      latitude: 41.8781,
      longitude: -87.6298,
    },
  },
  parkingAuthority: {
    name: 'City of Chicago Department of Finance',
    website: 'https://www.chicago.gov/finance',
    phone: '312-744-7275',
  },
};

export const chicagoAppConfig: AppCityConfig = {
  cityId: 'chicago',
  enabled: true,
  mapBounds: chicagoConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true,
    timeRestrictions: true,
    snowRoutes: true,
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'City Vehicle Sticker',
      streetCleaning: 'Street Cleaning',
      parkingTicket: 'Parking Ticket',
      meterParking: 'Metered Parking',
      permitZone: 'Residential Permit Parking Zone',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default chicagoConfig;
