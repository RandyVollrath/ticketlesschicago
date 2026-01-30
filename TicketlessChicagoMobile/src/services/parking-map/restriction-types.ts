/**
 * Comprehensive Restriction Types
 *
 * 14 universal restriction types that apply across ALL cities.
 * Build the data models once, configure per-city.
 */

// =============================================================================
// 1. Street Cleaning / Sweeping
// =============================================================================

export interface StreetCleaningRestriction {
  type: 'street-cleaning';
  schedule: {
    daysOfWeek: number[]; // 0=Sun, 1=Mon...
    startTime: string; // "09:00"
    endTime: string; // "11:00"
    weekOfMonth?: number[]; // [1,3] = 1st and 3rd week only
    seasonalStart?: string; // "04-01"
    seasonalEnd?: string; // "11-30"
  };
  side: 'north' | 'south' | 'east' | 'west';
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 2. Alternate Side Parking (NYC-specific but model is reusable)
// =============================================================================

export interface AlternateSideRestriction {
  type: 'alternate-side';
  schedule: {
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
  };
  side: 'north' | 'south' | 'east' | 'west';
  suspensionCalendar: string[]; // Holiday dates when suspended
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 3. Tow-Away Zones
// =============================================================================

export type TowAwaySubtype =
  | 'commute-hours' // SF-style rush hour tow zones
  | 'permanent' // No parking ever
  | 'event' // Game day, concert, etc.
  | 'construction' // Temporary
  | 'emergency'; // Snow emergency, etc.

export interface TowAwayRestriction {
  type: 'tow-away';
  subtype: TowAwaySubtype;
  schedule: {
    // Commute hours example
    morningStart?: string; // "07:00"
    morningEnd?: string; // "09:00"
    eveningStart?: string; // "15:00" or "16:00"
    eveningEnd?: string; // "19:00"
    daysOfWeek?: number[];
    // Or specific date range for events/construction
    startDate?: string;
    endDate?: string;
  };
  penalty: {
    fineAmount: number;
    towRisk: true; // Always true for tow-away
    towFee: number;
    storageFeePerDay: number;
  };
  noExemptions?: boolean; // SF tow zones have NO disabled placard exemption
}

// =============================================================================
// 4. Snow Emergency Routes
// =============================================================================

export type SnowEmergencySubtype =
  | 'snow-route' // Chicago 2"+ ban
  | 'winter-overnight' // Chicago Dec-Apr 3am-7am
  | 'declared-emergency'; // City-declared snow emergency

export interface SnowEmergencyRestriction {
  type: 'snow-emergency';
  subtype: SnowEmergencySubtype;
  trigger: {
    type: 'snowfall' | 'declaration' | 'seasonal';
    threshold?: string; // "2 inches"
    seasonStart?: string; // "12-01"
    seasonEnd?: string; // "04-01"
    timeStart?: string; // "03:00" for overnight
    timeEnd?: string; // "07:00"
  };
  penalty: {
    fineAmount: number;
    towRisk: boolean;
    towPriority: 'immediate' | 'delayed';
  };
}

// =============================================================================
// 5. Time-Limited Parking
// =============================================================================

export interface TimeLimitRestriction {
  type: 'time-limit';
  maxMinutes: number; // 30, 60, 120, 240, etc.
  schedule: {
    startTime: string; // "08:00"
    endTime: string; // "18:00"
    daysOfWeek: number[];
  };
  exemptions: {
    permitTypes: string[]; // ["residential", "disabled"]
  };
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 6. Metered Parking
// =============================================================================

export type PaymentMethod = 'coin' | 'card' | 'app';

export interface MeteredRestriction {
  type: 'metered';
  meterId?: string;
  rate: {
    amount: number; // cents per hour
    currency: 'USD';
  };
  maxTime: number; // minutes
  schedule: {
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
  };
  paymentMethods: PaymentMethod[];
  appZoneCode?: string; // For ParkMobile, PayByPhone, etc.
  feedingAllowed: boolean; // Can you add time?
  penalty: {
    expiredFine: number;
    noPaymentFine: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 7. Permit Parking Zones (Residential)
// =============================================================================

export interface PermitZoneRestriction {
  type: 'permit-zone';
  zoneId: string; // "Zone 383", "RPP Area A"
  zoneName?: string;
  schedule: {
    // When permit is required
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
  };
  nonPermitRules: {
    maxMinutes: number; // How long non-permit holders can stay
  };
  permitCost: number;
  permitUrl?: string;
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 8. Loading Zones
// =============================================================================

export type LoadingZoneSubtype =
  | 'commercial' // Yellow curb - trucks only
  | 'passenger' // White curb - pickup/dropoff
  | 'freight'; // Large vehicle loading

export interface LoadingZoneRestriction {
  type: 'loading-zone';
  subtype: LoadingZoneSubtype;
  schedule: {
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
  };
  maxMinutes: number; // Usually 3-30 minutes
  vehicleRequirements?: {
    commercialPlatesRequired: boolean;
    minAxles?: number;
  };
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 9. Color Curb Zones
// =============================================================================

export type CurbColor = 'red' | 'yellow' | 'white' | 'green' | 'blue';

export const CURB_COLOR_MEANINGS = {
  red: 'no-stopping',
  yellow: 'commercial-loading',
  white: 'passenger-loading',
  green: 'short-term', // Usually 10-30 min
  blue: 'disabled',
} as const;

export interface ColorCurbRestriction {
  type: 'color-curb';
  color: CurbColor;
  meaning: (typeof CURB_COLOR_MEANINGS)[CurbColor];
  schedule?: {
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
  };
  // Outside scheduled hours, may be regular parking
  offHoursRule?: 'allowed' | 'metered' | 'permit-required';
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 10. Proximity Restrictions (Universal - No Signs Needed)
// =============================================================================

export type ProximityObject =
  | 'fire-hydrant' // 15 feet (varies by city)
  | 'crosswalk' // 20 feet
  | 'intersection' // 20 feet from corner
  | 'stop-sign' // 30 feet
  | 'traffic-signal' // 30 feet
  | 'railroad-crossing' // 50 feet
  | 'fire-station' // 20 feet (75 feet opposite side)
  | 'bus-stop' // Within marked zone
  | 'driveway'; // Cannot block

export interface ProximityRestriction {
  type: 'proximity';
  nearObject: ProximityObject;
  distanceFeet: number; // City-specific
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 11. No Parking Anytime
// =============================================================================

export type NoParkingReason =
  | 'bus-lane'
  | 'bike-lane'
  | 'travel-lane'
  | 'fire-lane'
  | 'emergency-access'
  | 'sight-line' // Near corners for visibility
  | 'construction'
  | 'private-property';

export interface NoParkingRestriction {
  type: 'no-parking';
  reason?: NoParkingReason;
  permanent: boolean;
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 12. Special Event Restrictions
// =============================================================================

export interface EventRestriction {
  type: 'event';
  eventName: string;
  eventVenue?: string;
  schedule: {
    date: string;
    startTime: string;
    endTime: string;
  };
  affectedStreets: string[];
  alternateParking?: {
    garageId?: string;
    address?: string;
    discount?: string;
  };
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 13. Overnight Parking Bans
// =============================================================================

export interface OvernightRestriction {
  type: 'overnight-ban';
  schedule: {
    startTime: string; // "02:00" or "03:00"
    endTime: string; // "06:00" or "07:00"
    daysOfWeek?: number[]; // Some cities only certain nights
  };
  seasonal?: {
    startDate: string; // "12-01"
    endDate: string; // "04-01"
  };
  exemptions?: {
    permitTypes: string[];
  };
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// 14. Oversized Vehicle Restrictions
// =============================================================================

export interface OversizedVehicleRestriction {
  type: 'oversized-vehicle';
  maxLength?: number; // feet
  maxHeight?: number; // feet
  maxWeight?: number; // pounds
  schedule?: {
    startTime: string;
    endTime: string;
    daysOfWeek: number[];
  };
  penalty: {
    fineAmount: number;
    towRisk: boolean;
  };
}

// =============================================================================
// Union Type for All Restrictions
// =============================================================================

export type UniversalRestriction =
  | StreetCleaningRestriction
  | AlternateSideRestriction
  | TowAwayRestriction
  | SnowEmergencyRestriction
  | TimeLimitRestriction
  | MeteredRestriction
  | PermitZoneRestriction
  | LoadingZoneRestriction
  | ColorCurbRestriction
  | ProximityRestriction
  | NoParkingRestriction
  | EventRestriction
  | OvernightRestriction
  | OversizedVehicleRestriction;

export type UniversalRestrictionType = UniversalRestriction['type'];

// =============================================================================
// Helper Types
// =============================================================================

export interface Penalty {
  fineAmount: number;
  towRisk: boolean;
  towFee?: number;
  storageFeePerDay?: number;
}

export interface RestrictionSchedule {
  daysOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  weekOfMonth?: number[];
  seasonalStart?: string;
  seasonalEnd?: string;
}

// =============================================================================
// City Proximity Rules (varies by city/state)
// =============================================================================

export interface CityProximityRules {
  fireHydrant: number;
  crosswalk: number;
  intersection: number;
  stopSign: number;
  trafficSignal: number;
  railroadCrossing: number;
  fireStation: { same: number; opposite: number };
  alley?: number;
  busStop?: number;
  driveway?: number;
}

// Default proximity rules (most common in US)
export const DEFAULT_PROXIMITY_RULES: CityProximityRules = {
  fireHydrant: 15,
  crosswalk: 20,
  intersection: 20,
  stopSign: 30,
  trafficSignal: 30,
  railroadCrossing: 50,
  fireStation: { same: 20, opposite: 75 },
};
