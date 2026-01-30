/**
 * Multi-City Registry
 *
 * Central registry for all city configurations.
 * All cities except Chicago are DISABLED BY DEFAULT.
 *
 * To enable a city, update the feature flags in src/config/feature-flags.ts
 */

// Types
export * from './types';

// Chicago (ENABLED - Reference Implementation)
export { chicagoConfig, chicagoAppConfig } from './chicago/config';
export { chicagoStreetCleaningConfig } from './chicago/street-cleaning';
export { chicagoTicketConfig } from './chicago/tickets';

// NYC (DISABLED)
export { nycConfig, nycAppConfig } from './nyc/config';
export { nycStreetCleaningConfig } from './nyc/street-cleaning';
export { nycTicketConfig } from './nyc/tickets';

// Los Angeles (DISABLED)
export { losAngelesConfig, losAngelesAppConfig } from './los-angeles/config';
export { laStreetCleaningConfig } from './los-angeles/street-cleaning';
export { laTicketConfig } from './los-angeles/tickets';

// Boston (DISABLED)
export { bostonConfig, bostonAppConfig } from './boston/config';
export { bostonStreetCleaningConfig } from './boston/street-cleaning';
export { bostonTicketConfig } from './boston/tickets';

// San Francisco (DISABLED)
export { sanFranciscoConfig, sanFranciscoAppConfig } from './san-francisco/config';
export { sfStreetCleaningConfig } from './san-francisco/street-cleaning';
export { sfTicketConfig } from './san-francisco/tickets';

// Washington DC (DISABLED)
export { washingtonDCConfig, washingtonDCAppConfig } from './washington-dc/config';
export { dcStreetCleaningConfig } from './washington-dc/street-cleaning';
export { dcTicketConfig } from './washington-dc/tickets';

// Seattle (DISABLED)
export { seattleConfig, seattleAppConfig } from './seattle/config';
export { seattleStreetCleaningConfig } from './seattle/street-cleaning';
export { seattleTicketConfig } from './seattle/tickets';

// Denver (DISABLED)
export { denverConfig, denverAppConfig } from './denver/config';
export { denverStreetCleaningConfig } from './denver/street-cleaning';
export { denverTicketConfig } from './denver/tickets';

// Minneapolis (DISABLED)
export { minneapolisConfig, minneapolisAppConfig } from './minneapolis/config';
export { minneapolisStreetCleaningConfig } from './minneapolis/street-cleaning';
export { minneapolisTicketConfig } from './minneapolis/tickets';

// Portland (DISABLED)
export { portlandConfig, portlandAppConfig } from './portland/config';
export { portlandStreetCleaningConfig } from './portland/street-cleaning';
export { portlandTicketConfig } from './portland/tickets';

// Import all configs for registry
import { chicagoConfig, chicagoAppConfig } from './chicago/config';
import { chicagoStreetCleaningConfig } from './chicago/street-cleaning';
import { chicagoTicketConfig } from './chicago/tickets';

import { nycConfig, nycAppConfig } from './nyc/config';
import { nycStreetCleaningConfig } from './nyc/street-cleaning';
import { nycTicketConfig } from './nyc/tickets';

import { losAngelesConfig, losAngelesAppConfig } from './los-angeles/config';
import { laStreetCleaningConfig } from './los-angeles/street-cleaning';
import { laTicketConfig } from './los-angeles/tickets';

import { bostonConfig, bostonAppConfig } from './boston/config';
import { bostonStreetCleaningConfig } from './boston/street-cleaning';
import { bostonTicketConfig } from './boston/tickets';

import { sanFranciscoConfig, sanFranciscoAppConfig } from './san-francisco/config';
import { sfStreetCleaningConfig } from './san-francisco/street-cleaning';
import { sfTicketConfig } from './san-francisco/tickets';

import { washingtonDCConfig, washingtonDCAppConfig } from './washington-dc/config';
import { dcStreetCleaningConfig } from './washington-dc/street-cleaning';
import { dcTicketConfig } from './washington-dc/tickets';

import { seattleConfig, seattleAppConfig } from './seattle/config';
import { seattleStreetCleaningConfig } from './seattle/street-cleaning';
import { seattleTicketConfig } from './seattle/tickets';

import { denverConfig, denverAppConfig } from './denver/config';
import { denverStreetCleaningConfig } from './denver/street-cleaning';
import { denverTicketConfig } from './denver/tickets';

import { minneapolisConfig, minneapolisAppConfig } from './minneapolis/config';
import { minneapolisStreetCleaningConfig } from './minneapolis/street-cleaning';
import { minneapolisTicketConfig } from './minneapolis/tickets';

import { portlandConfig, portlandAppConfig } from './portland/config';
import { portlandStreetCleaningConfig } from './portland/street-cleaning';
import { portlandTicketConfig } from './portland/tickets';

import { CityConfig, AppCityConfig, CityStreetCleaningConfig, CityTicketConfig } from './types';

/**
 * All city configurations
 */
export const allCityConfigs: CityConfig[] = [
  chicagoConfig,
  nycConfig,
  losAngelesConfig,
  bostonConfig,
  sanFranciscoConfig,
  washingtonDCConfig,
  seattleConfig,
  denverConfig,
  minneapolisConfig,
  portlandConfig,
];

/**
 * All app city configurations
 */
export const allAppCityConfigs: AppCityConfig[] = [
  chicagoAppConfig,
  nycAppConfig,
  losAngelesAppConfig,
  bostonAppConfig,
  sanFranciscoAppConfig,
  washingtonDCAppConfig,
  seattleAppConfig,
  denverAppConfig,
  minneapolisAppConfig,
  portlandAppConfig,
];

/**
 * All street cleaning configurations
 */
export const allStreetCleaningConfigs: CityStreetCleaningConfig[] = [
  chicagoStreetCleaningConfig,
  nycStreetCleaningConfig,
  laStreetCleaningConfig,
  bostonStreetCleaningConfig,
  sfStreetCleaningConfig,
  dcStreetCleaningConfig,
  seattleStreetCleaningConfig,
  denverStreetCleaningConfig,
  minneapolisStreetCleaningConfig,
  portlandStreetCleaningConfig,
];

/**
 * All ticket configurations
 */
export const allTicketConfigs: CityTicketConfig[] = [
  chicagoTicketConfig,
  nycTicketConfig,
  laTicketConfig,
  bostonTicketConfig,
  sfTicketConfig,
  dcTicketConfig,
  seattleTicketConfig,
  denverTicketConfig,
  minneapolisTicketConfig,
  portlandTicketConfig,
];

/**
 * Get city config by ID
 */
export function getCityConfig(cityId: string): CityConfig | undefined {
  return allCityConfigs.find(c => c.cityId === cityId);
}

/**
 * Get app city config by ID
 */
export function getAppCityConfig(cityId: string): AppCityConfig | undefined {
  return allAppCityConfigs.find(c => c.cityId === cityId);
}

/**
 * Get street cleaning config by city ID
 */
export function getStreetCleaningConfig(cityId: string): CityStreetCleaningConfig | undefined {
  return allStreetCleaningConfigs.find(c => c.cityId === cityId);
}

/**
 * Get ticket config by city ID
 */
export function getTicketConfig(cityId: string): CityTicketConfig | undefined {
  return allTicketConfigs.find(c => c.cityId === cityId);
}

/**
 * Get all enabled cities
 */
export function getEnabledCities(): CityConfig[] {
  return allCityConfigs.filter(c => c.enabled);
}

/**
 * Check if a city is enabled
 */
export function isCityEnabled(cityId: string): boolean {
  const config = getCityConfig(cityId);
  return config?.enabled ?? false;
}
