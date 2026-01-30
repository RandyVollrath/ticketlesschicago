/**
 * Parking Map Services
 *
 * Comprehensive parking map platform exports.
 * All features hidden behind feature flags.
 */

// Types
export * from './types';

// Restriction Types (14 universal types)
// Note: RestrictionSchedule is re-exported from types, so we exclude it here
export type {
  StreetCleaningRestriction,
  AlternateSideRestriction,
  TowAwayRestriction,
  TowAwaySubtype,
  SnowEmergencyRestriction,
  SnowEmergencySubtype,
  TimeLimitRestriction,
  MeteredRestriction,
  PaymentMethod,
  PermitZoneRestriction,
  LoadingZoneRestriction,
  LoadingZoneSubtype,
  ColorCurbRestriction,
  CurbColor,
  ProximityRestriction,
  ProximityObject,
  NoParkingRestriction,
  NoParkingReason,
  EventRestriction,
  OvernightRestriction,
  OversizedVehicleRestriction,
  UniversalRestriction,
  UniversalRestrictionType,
  Penalty,
  CityProximityRules,
} from './restriction-types';

export {
  CURB_COLOR_MEANINGS,
  DEFAULT_PROXIMITY_RULES,
} from './restriction-types';

// Core Compute Services
export { default as ParkingStatusCompute } from './compute';
export {
  computeParkingStatus,
  computeBatchParkingStatus,
  updateSegmentStatus,
  isRestrictionActive,
  formatRestrictionDescription,
} from './compute';

// Snow Emergency Service
export { snowEmergencyService } from './SnowEmergencyService';
export { default as SnowEmergencyService } from './SnowEmergencyService';

// Segment Colorizer
export {
  getSegmentColor,
  getSegmentColors,
  getContrastTextColor,
  lightenColor,
  darkenColor,
} from './segment-colorizer';

// Warning Calculator
export {
  getUpcomingWarnings,
  getNextRestrictionStart,
  getNextRestrictionEnd,
  formatWarningMessage,
  getSeverity,
  getMinutesUntil,
  formatTimeRemaining,
} from './warning-calculator';
