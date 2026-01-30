/**
 * Washington DC City Configuration
 *
 * DISABLED BY DEFAULT
 *
 * Data Sources:
 * - DC Open Data: https://opendata.dc.gov/
 * - DDOT: https://ddot.dc.gov/
 * - DPW: https://dpw.dc.gov/service/street-sweeping
 */

import { CityConfig, AppCityConfig } from '../types';

export const washingtonDCConfig: CityConfig = {
  cityId: 'washington-dc',
  cityName: 'Washington',
  state: 'District of Columbia',
  stateAbbrev: 'DC',
  timezone: 'America/New_York',
  enabled: false, // DISABLED BY DEFAULT
  population: 689545,
  mapBounds: {
    north: 38.9958,
    south: 38.7916,
    east: -76.9094,
    west: -77.1197,
    center: {
      latitude: 38.9072,
      longitude: -77.0369,
    },
  },
  parkingAuthority: {
    name: 'DC Department of Motor Vehicles (DMV)',
    website: 'https://dmv.dc.gov/service/pay-parking-ticket',
    phone: '311',
  },
};

export const washingtonDCAppConfig: AppCityConfig = {
  cityId: 'washington-dc',
  enabled: false,
  mapBounds: washingtonDCConfig.mapBounds,
  defaultZoom: 13,
  parkingDataLayers: {
    streetCleaning: true,
    meters: true,
    permits: true, // Residential Permit Parking (RPP)
    timeRestrictions: true,
    snowRoutes: true, // DC has snow emergency routes
    loadingZones: true,
    handicap: true,
  },
  localizations: {
    terminology: {
      citySticker: 'N/A',
      streetCleaning: 'Street Sweeping',
      parkingTicket: 'Parking Ticket',
      meterParking: 'Metered Parking',
      permitZone: 'Residential Permit Parking (RPP)',
    },
    currency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12h',
  },
};

export default washingtonDCConfig;
