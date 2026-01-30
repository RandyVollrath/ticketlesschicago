/**
 * Parking Map Types
 *
 * Type definitions for the interactive parking map feature.
 * Chicago-specific implementation.
 */

// =============================================================================
// GeoJSON Types
// =============================================================================

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface GeoJSONLineString {
  type: 'LineString';
  coordinates: [number, number][]; // Array of [longitude, latitude]
}

export interface GeoJSONPolygon {
  type: 'Polygon';
  coordinates: [number, number][][];
}

export interface GeoJSONFeatureCollection<T = GeoJSONLineString | GeoJSONPolygon> {
  type: 'FeatureCollection';
  features: GeoJSONFeature<T>[];
}

export interface GeoJSONFeature<T = GeoJSONLineString | GeoJSONPolygon> {
  type: 'Feature';
  geometry: T;
  properties: Record<string, any>;
}

// =============================================================================
// Parking Status Types
// =============================================================================

// Enhanced parking status with more granular states
export type ParkingStatus =
  | 'allowed' // Green - can park now
  | 'restricted' // Red - cannot park
  | 'tow-zone' // Dark red - will be towed
  | 'warning' // Yellow - restriction coming soon
  | 'permit-required' // Purple - need permit
  | 'metered' // Blue - metered parking
  | 'conditional' // Orange - depends on weather/events
  | 'unknown'; // Gray - check signs

export interface ParkingStatusReason {
  type: RestrictionType;
  description: string;
  activeUntil?: Date;
  towRisk?: boolean;
}

export interface ParkingStatusResponse {
  status: ParkingStatus;
  reasons: ParkingStatusReason[];
  nextChange?: {
    time: Date;
    toStatus: ParkingStatus;
    reason: string;
  };
}

// =============================================================================
// Restriction Types
// =============================================================================

// All 14 universal restriction types
export type RestrictionType =
  | 'street-cleaning'
  | 'alternate-side'
  | 'tow-away'
  | 'snow-emergency'
  | 'time-limit'
  | 'metered'
  | 'permit-zone'
  | 'loading-zone'
  | 'color-curb'
  | 'proximity'
  | 'no-parking'
  | 'event'
  | 'overnight-ban'
  | 'oversized-vehicle'
  // Legacy types for backward compatibility
  | 'snow-route'
  | 'winter-ban';

export interface RestrictionSchedule {
  // Day/time restrictions (street cleaning)
  daysOfWeek?: number[]; // 0=Sunday, 1=Monday, etc.
  startTime?: string; // "09:00"
  endTime?: string; // "11:00"

  // Seasonal restrictions
  startDate?: string; // "04-01" (April 1)
  endDate?: string; // "11-30" (November 30)

  // Week of month (1st Monday, etc.)
  weekOfMonth?: number[]; // 1, 2, 3, 4

  // Conditional restrictions (snow routes)
  conditional?: {
    type: 'snow';
    threshold: string; // "2 inches"
  };

  // Permit zones
  permitZone?: string; // Zone number like "383"
  permitHours?: string; // "6pm-6am"
}

export interface Restriction {
  type: RestrictionType;
  schedule: RestrictionSchedule;
  description?: string;
}

// =============================================================================
// Street Segment Types
// =============================================================================

export interface StreetSegmentProperties {
  segmentId: string;
  streetName: string;
  blockStart: string; // "1200 N"
  blockEnd: string; // "1300 N"
  side: 'north' | 'south' | 'east' | 'west' | 'odd' | 'even' | 'both';
  ward?: string;
  route?: string;

  // Restriction data
  restrictions: Restriction[];

  // Computed at query time
  currentStatus: ParkingStatus;
  statusReason?: string;
  nextChange?: {
    time: Date;
    toStatus: ParkingStatus;
  };

  // Data quality
  dataConfidence: 'high' | 'medium' | 'low';
  lastUpdated?: string;
}

export interface StreetSegment extends GeoJSONFeature<GeoJSONLineString> {
  properties: StreetSegmentProperties;
}

export interface StreetSegmentCollection extends GeoJSONFeatureCollection<GeoJSONLineString> {
  features: StreetSegment[];
}

// =============================================================================
// Map Layer Types
// =============================================================================

export interface ParkingRestrictionLayer {
  id: string;
  name: string;
  type: RestrictionType;
  sourceType: 'geojson' | 'vector';
  sourceUrl?: string;
  data?: StreetSegmentCollection;
  visibility: 'visible' | 'none';
  enabled: boolean;

  // Styling
  colors: {
    allowed: string;
    restricted: string;
    warning: string;
    unknown: string;
  };
  lineWidth: number;
  lineOpacity: number;
}

export interface MapConfig {
  provider: 'mapbox' | 'google' | 'react-native-maps';
  center: [number, number]; // [longitude, latitude]
  zoom: number;
  bounds: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

// =============================================================================
// Weather/Snow Emergency Types
// =============================================================================

export interface SnowEmergencyStatus {
  isActive: boolean;
  declaredAt?: Date;
  expectedEnd?: Date;
  source: string;
  lastChecked: Date;
}

export interface WeatherConditions {
  snowEmergencyActive: boolean;
  winterBanActive: boolean;
  temperature?: number;
  snowfall?: number;
}

// =============================================================================
// API Types
// =============================================================================

export interface LayerQueryParams {
  bounds?: string; // "north,south,east,west"
  time?: string; // ISO timestamp
  permits?: string; // Comma-separated permit zones
}

export interface StatusQueryParams {
  lat: number;
  lng: number;
  time?: string;
  permits?: string;
}

// =============================================================================
// User Types
// =============================================================================

export interface UserParkingPreferences {
  permits: string[]; // User's permit zone numbers
  homeLocation?: [number, number];
  notificationEnabled: boolean;
}

// User context for personalized parking status
export interface UserContext {
  permits?: string[]; // User's permit zones
  vehicleType?: 'car' | 'motorcycle' | 'commercial' | 'oversized';
  hasDisabledPlacard?: boolean;
  homeLocation?: [number, number];
}

// Segment color result for rendering
export interface SegmentColorResult {
  primary: string; // Main line color
  secondary?: string; // Optional stripe/pattern
  opacity: number;
  dashPattern?: number[]; // For uncertain data
  pulseAnimation?: boolean; // For warnings
}

// Parking warning for upcoming restrictions
export interface ParkingWarning {
  type: 'upcoming-restriction' | 'ending-restriction' | 'conditional';
  minutesUntil: number;
  restriction: Restriction;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

// =============================================================================
// Chicago-Specific Constants
// =============================================================================

export const CHICAGO_MAP_CONFIG: MapConfig = {
  provider: 'react-native-maps',
  center: [-87.6298, 41.8781],
  zoom: 14,
  bounds: {
    north: 42.023,
    south: 41.644,
    east: -87.524,
    west: -87.940,
  },
};

// Enhanced color palette for all parking statuses
export const LAYER_COLORS = {
  allowed: '#22c55e', // green-500 - Can park
  restricted: '#ef4444', // red-500 - Cannot park
  towZone: '#dc2626', // red-600 (darker) - Tow risk
  warning: '#eab308', // yellow-500 - Restriction soon
  permitRequired: '#a855f7', // purple-500 - Permit zone
  metered: '#3b82f6', // blue-500 - Metered parking
  conditional: '#f97316', // orange-500 - Weather/event dependent
  unknown: '#9ca3af', // gray-400 - Check signs
};

// Map status to color
export const STATUS_TO_COLOR: Record<ParkingStatus, string> = {
  allowed: LAYER_COLORS.allowed,
  restricted: LAYER_COLORS.restricted,
  'tow-zone': LAYER_COLORS.towZone,
  warning: LAYER_COLORS.warning,
  'permit-required': LAYER_COLORS.permitRequired,
  metered: LAYER_COLORS.metered,
  conditional: LAYER_COLORS.conditional,
  unknown: LAYER_COLORS.unknown,
};

export const DEFAULT_LAYERS: Omit<ParkingRestrictionLayer, 'data'>[] = [
  {
    id: 'street-cleaning',
    name: 'Street Cleaning',
    type: 'street-cleaning',
    sourceType: 'geojson',
    visibility: 'visible',
    enabled: true,
    colors: LAYER_COLORS,
    lineWidth: 4,
    lineOpacity: 0.8,
  },
  {
    id: 'snow-routes',
    name: 'Snow Routes (2" Ban)',
    type: 'snow-route',
    sourceType: 'geojson',
    visibility: 'visible',
    enabled: true,
    colors: LAYER_COLORS,
    lineWidth: 4,
    lineOpacity: 0.8,
  },
  {
    id: 'winter-ban',
    name: 'Winter Overnight Ban',
    type: 'winter-ban',
    sourceType: 'geojson',
    visibility: 'visible',
    enabled: true,
    colors: LAYER_COLORS,
    lineWidth: 4,
    lineOpacity: 0.8,
  },
  {
    id: 'permit-zones',
    name: 'Permit Parking Zones',
    type: 'permit-zone',
    sourceType: 'geojson',
    visibility: 'visible',
    enabled: true,
    colors: LAYER_COLORS,
    lineWidth: 4,
    lineOpacity: 0.8,
  },
];
