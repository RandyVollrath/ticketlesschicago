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

  // Bluetooth / Car
  SAVED_CAR_DEVICE: 'savedCarDevice',
  BLUETOOTH_PERMISSIONS_REQUESTED: 'bluetoothPermissionsRequested',

  // Push Notifications
  PUSH_TOKEN: 'pushToken',
  PUSH_TOKEN_REGISTERED: 'pushTokenRegistered',

  // User Preferences
  BACKGROUND_LOCATION_ENABLED: 'backgroundLocationEnabled',
  AUTO_CHECK_ON_DISCONNECT: 'autoCheckOnDisconnect',

  // Cache
  LAST_API_RESPONSE_CACHE: 'lastApiResponseCache',
  GEOCODE_CACHE: 'geocodeCache',

  // Background Tasks
  BACKGROUND_TASK_STATE: 'backgroundTaskState',
} as const;

// Type for storage keys
export type StorageKey = typeof StorageKeys[keyof typeof StorageKeys];

// Keys that should be cleared on logout
export const LOGOUT_CLEAR_KEYS: StorageKey[] = [
  StorageKeys.AUTH_TOKEN,
  StorageKeys.PARKING_HISTORY,
  StorageKeys.LAST_PARKING_LOCATION,
  StorageKeys.PUSH_TOKEN,
  StorageKeys.PUSH_TOKEN_REGISTERED,
  StorageKeys.LAST_API_RESPONSE_CACHE,
];

// Keys that persist across logout (user preferences)
export const PERSISTENT_KEYS: StorageKey[] = [
  StorageKeys.HAS_ONBOARDED,
  StorageKeys.HAS_SEEN_LOGIN,
  StorageKeys.APP_SETTINGS,
  StorageKeys.SAVED_CAR_DEVICE,
  StorageKeys.NOTIFICATION_SETTINGS,
];

export default StorageKeys;
