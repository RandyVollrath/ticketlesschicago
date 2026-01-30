/**
 * Shared Types for Multi-City Support
 *
 * All city configurations must conform to these interfaces.
 * This ensures consistency across all city implementations.
 */

// =============================================================================
// Core City Configuration
// =============================================================================

export interface CityConfig {
  cityId: string;
  cityName: string;
  state: string;
  stateAbbrev: string;
  timezone: string;
  enabled: boolean; // DEFAULT FALSE for all new cities
  mapBounds: MapBounds;
  population?: number;
  parkingAuthority: {
    name: string;
    website: string;
    phone?: string;
  };
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  center: {
    latitude: number;
    longitude: number;
  };
}

// =============================================================================
// Street Cleaning Configuration
// =============================================================================

export interface CityStreetCleaningConfig {
  cityId: string;
  enabled: boolean; // DEFAULT FALSE
  dataSource: StreetCleaningDataSource;
  scheduleFormat: StreetCleaningScheduleFormat;
  seasonalRules: SeasonalRules;
  holidayRules: HolidayRules;
  notificationDefaults: NotificationDefaults;
}

export interface StreetCleaningDataSource {
  type: 'api' | 'scrape' | 'static' | 'geojson';
  url?: string;
  apiKey?: string; // Reference to env var name, not actual key
  updateFrequency: 'realtime' | 'daily' | 'weekly' | 'monthly' | 'annually' | 'static';
  lastUpdated?: string;
  documentation?: string;
}

export interface StreetCleaningScheduleFormat {
  usesOddEven: boolean; // Odd/even side of street
  usesDayOfWeek: boolean; // Monday, Tuesday, etc.
  usesWeekOfMonth: boolean; // 1st Monday, 2nd Tuesday, etc.
  usesDateRanges: boolean; // Seasonal date ranges
  usesTimeRanges: boolean; // Specific hours
  usesZones: boolean; // Geographic zones/routes
  usesRoutes: boolean; // Named routes
}

export interface SeasonalRules {
  activeSeason: {
    startMonth: number; // 1-12
    startDay: number;
    endMonth: number;
    endDay: number;
  };
  suspendedMonths?: number[]; // Months when cleaning is suspended (1-12)
  winterSuspension: boolean;
  notes?: string;
}

export interface HolidayRules {
  observedHolidays: string[]; // Holiday names that suspend cleaning
  makeupPolicy: 'none' | 'next_day' | 'skip' | 'varies';
  notes?: string;
}

export interface NotificationDefaults {
  hoursBeforeAlert: number;
  smsEnabled: boolean;
  emailEnabled: boolean;
  pushEnabled: boolean;
}

// =============================================================================
// Street Cleaning Schedule Data
// =============================================================================

export interface StreetCleaningSchedule {
  id: string;
  cityId: string;
  streetName: string;
  blockRange?: string; // "100-200" or "N of Main St"
  side: 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both';
  dayOfWeek: number[]; // 0=Sunday, 1=Monday, etc.
  weekOfMonth?: number[]; // 1, 2, 3, 4, 5 (5 = last)
  startTime: string; // "08:00"
  endTime: string; // "12:00"
  zone?: string;
  route?: string;
  seasonalOnly: boolean;
  geometry?: GeoJSON.LineString | GeoJSON.Polygon;
}

// =============================================================================
// Ticket Contest Configuration
// =============================================================================

export interface CityTicketConfig {
  cityId: string;
  enabled: boolean; // DEFAULT FALSE
  ticketAuthority: TicketAuthority;
  violationCodes: ViolationCode[];
  contestProcess: ContestProcess;
  weatherDefenseApplicable: boolean;
  requiredContestFields: string[];
}

export interface TicketAuthority {
  name: string;
  website: string;
  contestUrl?: string;
  paymentUrl?: string;
  phone?: string;
  address?: string;
}

export interface ViolationCode {
  code: string;
  description: string;
  shortDescription?: string;
  fineAmount: number;
  lateFee?: number;
  contestable: boolean;
  commonDefenses: string[];
  weatherRelated: boolean;
  signageRelated: boolean;
  notes?: string;
}

export interface ContestProcess {
  method: 'online' | 'mail' | 'in-person' | 'multiple';
  availableMethods: ('online' | 'mail' | 'in-person')[];
  deadlineDays: number; // Days to contest after ticket issued
  onlinePortalUrl?: string;
  mailAddress?: string;
  hearingInfo?: string;
  requiresNotarization: boolean;
  requiresAttorney: boolean;
  appealAvailable: boolean;
  appealDeadlineDays?: number;
  notes?: string;
}

// =============================================================================
// Mobile App City Configuration
// =============================================================================

export interface AppCityConfig {
  cityId: string;
  enabled: boolean; // DEFAULT FALSE - controls visibility in app
  mapBounds: MapBounds;
  defaultZoom: number;
  parkingDataLayers: ParkingDataLayers;
  localizations: CityLocalizations;
}

export interface ParkingDataLayers {
  streetCleaning: boolean;
  meters: boolean;
  permits: boolean;
  timeRestrictions: boolean;
  snowRoutes: boolean;
  loadingZones: boolean;
  handicap: boolean;
}

export interface CityLocalizations {
  // Local terminology that differs from Chicago
  terminology: {
    citySticker?: string; // "city sticker" vs "resident permit" vs "residential parking permit"
    streetCleaning?: string; // "street cleaning" vs "street sweeping"
    parkingTicket?: string; // "parking ticket" vs "parking citation" vs "parking violation"
    meterParking?: string;
    permitZone?: string;
  };
  currency: string; // Usually "USD"
  dateFormat: string;
  timeFormat: '12h' | '24h';
}

// =============================================================================
// Vehicle Registration Configuration (Research Only)
// =============================================================================

export interface StateRegistrationInfo {
  state: string;
  stateAbbrev: string;
  dmvName: string;
  dmvWebsite: string;
  onlineRenewalAvailable: boolean;
  remitterLicenseRequired: boolean;
  cities: CityRegistrationInfo[];
  licensingPath?: LicensingPath;
}

export interface CityRegistrationInfo {
  cityId: string;
  cityName: string;
  cityVehicleRegistrationRequired: boolean;
  registrationType?: string; // "City Sticker", "Wheel Tax", etc.
  cost?: number;
  deadline?: string; // "Annual by plate expiration" or specific date
  onlineRenewalUrl?: string;
  notes?: string;
}

export interface LicensingPath {
  steps: string[];
  estimatedTimeline: string;
  estimatedCost: string;
  requirements: string[];
  notes?: string;
}

// =============================================================================
// Utility Types
// =============================================================================

export type CityId =
  | 'chicago'
  | 'nyc'
  | 'los-angeles'
  | 'philadelphia'
  | 'boston'
  | 'san-francisco'
  | 'washington-dc'
  | 'seattle'
  | 'denver'
  | 'minneapolis'
  | 'portland';

export const SUPPORTED_CITIES: CityId[] = [
  'chicago',
  'nyc',
  'los-angeles',
  'philadelphia',
  'boston',
  'san-francisco',
  'washington-dc',
  'seattle',
  'denver',
  'minneapolis',
  'portland',
];

// GeoJSON types for geometry data
export namespace GeoJSON {
  export interface Point {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  }

  export interface LineString {
    type: 'LineString';
    coordinates: [number, number][];
  }

  export interface Polygon {
    type: 'Polygon';
    coordinates: [number, number][][];
  }
}
