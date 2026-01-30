/**
 * Los Angeles City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - LA Open Data: https://data.lacity.org/
 * - LADOT: https://ladot.lacity.org/
 */

import { CityConfig, AppCityConfig } from '../types';

export const losAngelesConfig: CityConfig = {
  cityId: 'los-angeles',
  cityName: 'Los Angeles',
  state: 'California',
  stateAbbrev: 'CA',
  timezone: 'America/Los_Angeles',
  enabled: false, // DISABLED BY DEFAULT
  population: 3898747,
  mapBounds: {
    north: 34.337306,
    south: 33.703652,
    east: -118.155289,
    west: -118.668176,
    center: {
      latitude: 34.0522,
      longitude: -118.2437,
    },
  },
  parkingAuthority: {
    name: 'City of Los Angeles - Parking Violations Bureau',
    website: 'https://prodpci.etimspayments.com/pbw/include/la_parking/input.jsp',
    phone: '866-561-9744',
  },
};

export const losAngelesAppConfig: AppCityConfig = {
  cityId: 'los-angeles',
  enabled: false,
  mapBounds: losAngelesConfig.mapBounds,
  defaultZoom: 12,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Preferential parking districts
    timeRestrictions: true,
    snowRoutes: false, // LA doesn't have snow routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Sweeping',
      parkingTicket: 'Parking Citation',
      meterParking: 'Metered Parking',
      permitZone: 'Preferential Parking District',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default losAngelesConfig;
