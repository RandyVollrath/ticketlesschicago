// App version - update this when releasing new versions
export const APP_VERSION = '1.0.0';
export const BUILD_NUMBER = '1';

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
};

export default {
  // API Configuration
  API_BASE_URL: __DEV__
    ? 'http://localhost:3000' // Development
    : 'https://ticketless.fyi', // Production

  // App Info
  APP_VERSION,
  BUILD_NUMBER,
  APP_NAME: 'Ticketless Chicago',
  BUNDLE_ID: 'fyi.ticketless.app',

  // Supabase configuration (same as web app)
  // Note: The anon key is a public key designed for client-side use with RLS
  SUPABASE_URL: ENV.SUPABASE_URL,
  SUPABASE_ANON_KEY: ENV.SUPABASE_ANON_KEY,

  // Deep Linking
  URL_SCHEME: 'ticketlesschicago',
  WEBSITE_URL: 'https://ticketless.fyi',

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
