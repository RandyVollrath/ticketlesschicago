// App version - update this when releasing new versions
export const APP_VERSION = '1.0.8';
export const BUILD_NUMBER = '9';

/**
 * Environment-specific configuration
 *
 * For production builds, these values should be injected via:
 * - react-native-config (.env files)
 * - Or build-time environment variables
 *
 * The anon key is safe to expose (it's a public key for client-side use)
 * but keeping it configurable allows for different Supabase projects per environment.
 */
const ENV = {
  // Supabase configuration - these are public keys safe for client-side use
  // The anon key only allows access to public data and RLS-protected resources
  SUPABASE_URL: 'https://dzhqolbhuqdcpngdayuq.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6aHFvbGJodXFkY3BuZ2RheXVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkyOTMzNDksImV4cCI6MjA3NDg2OTM0OX0.n6X0Tvexf2bR8nEkP_YzQsX__C4zgH29BPBx3F0Lik0',
  // Google OAuth Web Client ID (from Google Cloud Console, must match Supabase config)
  // This is the WEB client ID, not the Android client ID
  GOOGLE_WEB_CLIENT_ID: '475235892792-f369h80bodv82phk7n438rtu677fapqt.apps.googleusercontent.com',
};

export default {
  // API Configuration
  // Note: Always use production API since localhost isn't reachable from physical devices
  // For local backend testing, replace with your Mac's IP: 'http://192.168.x.x:3000'
  API_BASE_URL: 'https://autopilotamerica.com',

  // App Info
  APP_VERSION,
  BUILD_NUMBER,
  APP_NAME: 'Autopilot America',
  BUNDLE_ID: 'fyi.ticketless.app',

  // Supabase configuration (same as web app)
  // Note: The anon key is a public key designed for client-side use with RLS
  SUPABASE_URL: ENV.SUPABASE_URL,
  SUPABASE_ANON_KEY: ENV.SUPABASE_ANON_KEY,

  // Google OAuth configuration
  GOOGLE_WEB_CLIENT_ID: ENV.GOOGLE_WEB_CLIENT_ID,

  // Deep Linking
  URL_SCHEME: 'autopilotamerica',
  WEBSITE_URL: 'https://autopilotamerica.com',

  // Timeouts (in milliseconds)
  API_TIMEOUT: 15000,
  LOCATION_TIMEOUT: 10000,

  // Feature Flags
  ENABLE_ANALYTICS: !__DEV__,
  ENABLE_CRASH_REPORTING: !__DEV__,

  // Chicago Parking Rules Configuration
  PARKING_RULES: {
    // Winter overnight parking ban dates
    WINTER_BAN_START_MONTH: 12, // December
    WINTER_BAN_START_DAY: 1,
    WINTER_BAN_END_MONTH: 4, // April
    WINTER_BAN_END_DAY: 1,
    WINTER_BAN_START_HOUR: 3, // 3 AM
    WINTER_BAN_END_HOUR: 7, // 7 AM

    // Street cleaning typical hours
    STREET_CLEANING_START_HOUR: 9, // 9 AM
    STREET_CLEANING_END_HOUR: 15, // 3 PM

    // Snow ban threshold
    SNOW_BAN_INCHES: 2,
  },

  // Stats Configuration
  STATS: {
    // Estimated percentage of violations that would have resulted in tickets
    VIOLATION_TO_TICKET_RATE: 0.7,
    // Average parking ticket cost in Chicago
    AVERAGE_TICKET_COST: 65,
  },

  // Bluetooth Configuration
  BLUETOOTH: {
    SCAN_DURATION_SECONDS: 10,
    CONNECTION_CHECK_INTERVAL_MS: 5000,
  },
};
