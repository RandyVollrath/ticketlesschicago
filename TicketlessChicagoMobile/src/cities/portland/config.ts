/**
 * Portland City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - Portland Open Data: https://gis-pdx.opendata.arcgis.com/
 * - PBOT: https://www.portland.gov/transportation
 */

import { CityConfig, AppCityConfig } from '../types';

export const portlandConfig: CityConfig = {
  cityId: 'portland',
  cityName: 'Portland',
  state: 'Oregon',
  stateAbbrev: 'OR',
  timezone: 'America/Los_Angeles',
  enabled: false, // DISABLED BY DEFAULT
  population: 652503,
  mapBounds: {
    north: 45.6530,
    south: 45.4324,
    east: -122.4719,
    west: -122.8367,
    center: {
      latitude: 45.5152,
      longitude: -122.6784,
    },
  },
  parkingAuthority: {
    name: 'Portland Bureau of Transportation (PBOT)',
    website: 'https://www.portland.gov/transportation/parking',
    phone: '503-823-5185',
  },
};

export const portlandAppConfig: AppCityConfig = {
  cityId: 'portland',
  enabled: false,
  mapBounds: portlandConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Area parking permits
    timeRestrictions: true,
    snowRoutes: false, // Portland rarely has snow emergencies
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Sweeping',
      parkingTicket: 'Parking Citation',
      meterParking: 'Metered Parking',
      permitZone: 'Area Parking Permit',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default portlandConfig;
