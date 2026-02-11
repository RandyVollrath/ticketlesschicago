/**
 * Centralized storage keys for AsyncStorage
 *
 * Using a constants file eliminates magic strings and makes it easier to:
 * - Find all storage keys used in the app
 * - Prevent typos and duplicate keys
 * - Clear specific data categories during logout
 */

export const StorageKeys = {
  // Auth & Session
  AUTH_TOKEN: 'auth_token',
  AUTH_SESSION: 'supabase.auth.token',

  // App State
  HAS_ONBOARDED: 'hasOnboarded',
  HAS_SEEN_LOGIN: 'hasSeenLogin',

  // Settings
  APP_SETTINGS: 'appSettings',
  NOTIFICATION_SETTINGS: 'notificationSettings',

  // Parking Data
  LAST_PARKING_LOCATION: 'lastParkingLocation',
  PARKING_HISTORY: 'parkingHistory',
  CAMERA_PASS_HISTORY: 'cameraPassHistory',
  RED_LIGHT_RECEIPTS: 'redLightReceipts',
  SAVED_DESTINATIONS: 'savedDestinations',

  // Bluetooth / Car
  SAVED_CAR_DEVICE: 'savedCarDevice',
  BLUETOOTH_PERMISSIONS_REQUESTED: 'bluetoothPermissionsRequested',

  // Push Notifications
  PUSH_TOKEN: 'pushToken',
  PUSH_TOKEN_REGISTERED: 'pushTokenRegistered',

  // User Preferences
  BACKGROUND_LOCATION_ENABLED: 'backgroundLocationEnabled',
  HOME_PERMIT_ZONE: 'homePermitZone', // User's home permit zone number

  // Cache
  LAST_API_RESPONSE_CACHE: 'lastApiResponseCache',
  GEOCODE_CACHE: 'geocodeCache',

  // Background Tasks
  BACKGROUND_TASK_STATE: 'backgroundTaskState',
  MOTION_ACTIVITY_STATE: 'motionActivityState',

  // Periodic Rescan
  LAST_PARKED_COORDS: 'lastParkedCoords', // { lat, lng, parkedAt (ISO), address }
  RESCAN_LAST_RUN: 'rescanLastRun', // ISO timestamp of last periodic rescan

  // Snow Forecast Monitoring
  SNOW_FORECAST_LAST_CHECK: 'snowForecastLastCheck', // ISO timestamp
  SNOW_FORECAST_NOTIFIED: 'snowForecastNotified', // 'true' if already warned about upcoming snow

  // One-time nudges
  PLATE_COMPLIANCE_NUDGE_DISMISSED: 'plateComplianceNudgeDismissed', // 'true' if user dismissed the front plate nudge
} as const;

// Type for storage keys
export type StorageKey = typeof StorageKeys[keyof typeof StorageKeys];

// Keys that should be cleared on logout
export const LOGOUT_CLEAR_KEYS: StorageKey[] = [
  StorageKeys.AUTH_TOKEN,
  StorageKeys.PUSH_TOKEN,
  StorageKeys.PUSH_TOKEN_REGISTERED,
  StorageKeys.LAST_API_RESPONSE_CACHE,
];

// Keys that persist across logout (user preferences and parking data)
export const PERSISTENT_KEYS: StorageKey[] = [
  StorageKeys.HAS_ONBOARDED,
  StorageKeys.HAS_SEEN_LOGIN,
  StorageKeys.APP_SETTINGS,
  StorageKeys.SAVED_CAR_DEVICE,
  StorageKeys.NOTIFICATION_SETTINGS,
  StorageKeys.PARKING_HISTORY,
  StorageKeys.CAMERA_PASS_HISTORY,
  StorageKeys.RED_LIGHT_RECEIPTS,
  StorageKeys.SAVED_DESTINATIONS,
  StorageKeys.LAST_PARKING_LOCATION,
  StorageKeys.LAST_PARKED_COORDS,
];

export default StorageKeys;
