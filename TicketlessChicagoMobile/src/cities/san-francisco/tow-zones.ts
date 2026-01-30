/**
 * San Francisco Tow-Away Zone Configuration
 *
 * SF has some of the strictest tow-away zones in the US.
 * Rush hour lanes become tow zones - NO EXEMPTIONS, not even disabled placards!
 */

import { TowAwayRestriction } from '../../services/parking-map/restriction-types';

// =============================================================================
// Commute Hour Tow-Away Zones
// =============================================================================

export interface SFTowZone {
  name: string;
  streets: string[];
  direction: 'inbound' | 'outbound' | 'both';
  schedule: {
    morning: { start: string; end: string };
    evening: { start: string; end: string };
  };
  daysOfWeek: number[]; // 1-5 = Mon-Fri typically
  noExemptions: boolean; // TRUE for most SF tow zones
}

export const SF_COMMUTE_TOW_ZONES: SFTowZone[] = [
  // Downtown Inbound Morning
  {
    name: 'Market Street Inbound',
    streets: ['Market St'],
    direction: 'inbound',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: 'Van Ness Avenue',
    streets: ['Van Ness Ave'],
    direction: 'both',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: 'Geary Boulevard',
    streets: ['Geary Blvd', 'Geary St'],
    direction: 'both',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: '19th Avenue',
    streets: ['19th Ave'],
    direction: 'both',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '15:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: 'Lombard Street',
    streets: ['Lombard St'],
    direction: 'inbound',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: 'Park Presidio Boulevard',
    streets: ['Park Presidio Blvd'],
    direction: 'both',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: 'Fell Street',
    streets: ['Fell St'],
    direction: 'inbound',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
  {
    name: 'Oak Street',
    streets: ['Oak St'],
    direction: 'outbound',
    schedule: {
      morning: { start: '07:00', end: '09:00' },
      evening: { start: '16:00', end: '19:00' },
    },
    daysOfWeek: [1, 2, 3, 4, 5],
    noExemptions: true,
  },
];

// =============================================================================
// Tow-Away Penalties
// =============================================================================

export const SF_TOW_PENALTIES = {
  towFee: 550, // Base tow fee
  storageFeePerDay: 75, // Per day storage
  ticketFine: 122, // Tow-away zone violation fine
  adminFee: 290, // Administrative fee
  totalFirstDay: 1037, // Approximate total first day cost
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if current time is within tow-away hours for a zone
 */
export function isTowZoneActive(zone: SFTowZone, date: Date): boolean {
  const day = date.getDay();
  if (!zone.daysOfWeek.includes(day)) {
    return false;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  // Check morning window
  if (
    zone.schedule.morning &&
    timeStr >= zone.schedule.morning.start &&
    timeStr < zone.schedule.morning.end
  ) {
    return true;
  }

  // Check evening window
  if (
    zone.schedule.evening &&
    timeStr >= zone.schedule.evening.start &&
    timeStr < zone.schedule.evening.end
  ) {
    return true;
  }

  return false;
}

/**
 * Get next tow zone activation time for a zone
 */
export function getNextTowZoneActivation(
  zone: SFTowZone,
  from: Date
): Date | null {
  const current = new Date(from);

  for (let i = 0; i < 7; i++) {
    const day = current.getDay();

    if (zone.daysOfWeek.includes(day)) {
      const currentTimeStr = formatTime(current);

      // Check morning window
      if (currentTimeStr < zone.schedule.morning.start) {
        return parseTimeToDate(zone.schedule.morning.start, current);
      }

      // Check evening window
      if (currentTimeStr < zone.schedule.evening.start) {
        return parseTimeToDate(zone.schedule.evening.start, current);
      }
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
    current.setHours(0, 0, 0, 0);
  }

  return null;
}

/**
 * Create TowAwayRestriction from SF zone config
 */
export function createTowRestriction(zone: SFTowZone): TowAwayRestriction {
  return {
    type: 'tow-away',
    subtype: 'commute-hours',
    schedule: {
      morningStart: zone.schedule.morning.start,
      morningEnd: zone.schedule.morning.end,
      eveningStart: zone.schedule.evening.start,
      eveningEnd: zone.schedule.evening.end,
      daysOfWeek: zone.daysOfWeek,
    },
    penalty: {
      fineAmount: SF_TOW_PENALTIES.ticketFine,
      towRisk: true,
      towFee: SF_TOW_PENALTIES.towFee,
      storageFeePerDay: SF_TOW_PENALTIES.storageFeePerDay,
    },
    noExemptions: zone.noExemptions,
  };
}

// =============================================================================
// SF Color Curb System
// =============================================================================

export interface SFColorCurb {
  color: 'red' | 'yellow' | 'white' | 'green' | 'blue';
  meaning: string;
  maxMinutes?: number;
  towRisk: boolean;
  driverMustStay?: boolean;
}

export const SF_COLOR_CURBS: Record<string, SFColorCurb> = {
  red: {
    color: 'red',
    meaning: 'No stopping/parking anytime',
    towRisk: true,
  },
  yellow: {
    color: 'yellow',
    meaning: 'Commercial loading only during hours',
    maxMinutes: 30,
    towRisk: true,
  },
  white: {
    color: 'white',
    meaning: 'Passenger loading only, 5 min max, driver must stay',
    maxMinutes: 5,
    towRisk: true,
    driverMustStay: true,
  },
  green: {
    color: 'green',
    meaning: 'Short-term parking, usually 10-30 min',
    maxMinutes: 30,
    towRisk: false,
  },
  blue: {
    color: 'blue',
    meaning: 'Disabled parking only',
    towRisk: false,
  },
};

// =============================================================================
// Utility Functions
// =============================================================================

function formatTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function parseTimeToDate(timeStr: string, referenceDate: Date): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const result = new Date(referenceDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export default {
  SF_COMMUTE_TOW_ZONES,
  SF_TOW_PENALTIES,
  SF_COLOR_CURBS,
  isTowZoneActive,
  getNextTowZoneActivation,
  createTowRestriction,
};
