/**
 * Smart Features
 *
 * Collection of smart parking features that rival SpotAngels and ParkWhiz.
 * All features are behind feature flags.
 */

export { carDetectionService } from './car-detection';
export type {
  CarBluetoothConfig,
  ParkingLocation,
  ParkingReminder,
} from './car-detection';

export { findMyCarService } from './find-my-car';
export type {
  ParkedCarLocation,
  DirectionsResult,
  DirectionStep,
} from './find-my-car';

export { meterPaymentService, PAYMENT_PROVIDERS } from './meter-payment';
export type { MeterPaymentProvider, MeterInfo } from './meter-payment';

// Feature flags for smart features
export interface SmartFeaturesFlags {
  bluetoothDetection: boolean;
  findMyCar: boolean;
  meterPaymentLinks: boolean;
  crowdsourcedReports: boolean;
  garageSuggestions: boolean;
  eventAwareness: boolean;
  sweeperTracking: boolean;
}

// Default: all disabled
export const DEFAULT_SMART_FEATURES_FLAGS: SmartFeaturesFlags = {
  bluetoothDetection: false,
  findMyCar: false,
  meterPaymentLinks: false,
  crowdsourcedReports: false,
  garageSuggestions: false,
  eventAwareness: false,
  sweeperTracking: false,
};
