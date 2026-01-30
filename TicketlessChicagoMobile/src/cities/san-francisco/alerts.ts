/**
 * San Francisco Alert Rules
 *
 * City-specific alert configurations for San Francisco parking.
 *
 * Key SF rules:
 * - Commute hour tow zones - VERY STRICT, NO EXEMPTIONS
 * - 72-hour rule
 * - Curb your wheels on hills
 * - Color curb enforcement
 */

import { SF_COMMUTE_TOW_ZONES, isTowZoneActive } from './tow-zones';

// =============================================================================
// Types
// =============================================================================

export interface AlertTimeConfig {
  beforeMinutes: number;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface SFAlertRules {
  commuteHourTowZone: {
    enabled: boolean;
    noExemptions: boolean;
    alertTimes: AlertTimeConfig[];
    morningWindow: { start: string; end: string };
    eveningWindow: { start: string; end: string };
  };
  seventyTwoHourRule: {
    enabled: boolean;
    alertAtHours: number;
    fine: number;
  };
  curbWheelsReminder: {
    enabled: boolean;
    gradeThreshold: number;
    fine: number;
  };
  streetCleaning: {
    enabled: boolean;
    alertTimes: AlertTimeConfig[];
  };
  colorCurb: {
    enabled: boolean;
    strictEnforcement: boolean;
  };
  meterExpiration: {
    enabled: boolean;
    alertTimes: AlertTimeConfig[];
  };
}

// =============================================================================
// SF Alert Rules
// =============================================================================

export const sfAlertRules: SFAlertRules = {
  // Commute hour tow zones - VERY STRICT, NO EXEMPTIONS
  commuteHourTowZone: {
    enabled: true,
    noExemptions: true, // Even disabled placards get towed!
    morningWindow: { start: '07:00', end: '09:00' },
    eveningWindow: { start: '15:00', end: '19:00' }, // Some streets vary
    alertTimes: [
      {
        beforeMinutes: 120,
        message: 'Tow zone activates in 2 hours',
        severity: 'info',
      },
      {
        beforeMinutes: 60,
        message: 'TOW ZONE in 1 hour - NO EXEMPTIONS (even disabled)!',
        severity: 'warning',
      },
      {
        beforeMinutes: 30,
        message: 'TOW ZONE in 30 min - even disabled placards get towed!',
        severity: 'critical',
      },
      {
        beforeMinutes: 15,
        message: 'TOW ZONE in 15 min - MOVE NOW! NO EXEMPTIONS!',
        severity: 'critical',
      },
      {
        beforeMinutes: 0,
        message: 'TOW ZONE ACTIVE - Your car WILL be towed!',
        severity: 'critical',
      },
    ],
  },

  // 72-hour rule
  seventyTwoHourRule: {
    enabled: true,
    alertAtHours: 48, // Alert at 48 hours
    fine: 74,
  },

  // Curb your wheels on hills
  curbWheelsReminder: {
    enabled: true,
    gradeThreshold: 3, // 3% grade
    fine: 61,
  },

  // Street cleaning
  streetCleaning: {
    enabled: true,
    alertTimes: [
      {
        beforeMinutes: 720,
        message: 'Street cleaning tomorrow',
        severity: 'info',
      },
      {
        beforeMinutes: 60,
        message: 'Street cleaning in 1 hour',
        severity: 'warning',
      },
      {
        beforeMinutes: 30,
        message: 'Street cleaning in 30 minutes!',
        severity: 'warning',
      },
      {
        beforeMinutes: 15,
        message: 'Street cleaning in 15 minutes - MOVE NOW!',
        severity: 'critical',
      },
    ],
  },

  // Color curb enforcement
  colorCurb: {
    enabled: true,
    strictEnforcement: true, // SF is strict about color curbs
  },

  // Meter expiration
  meterExpiration: {
    enabled: true,
    alertTimes: [
      {
        beforeMinutes: 15,
        message: 'Meter expires in 15 minutes',
        severity: 'warning',
      },
      {
        beforeMinutes: 5,
        message: 'Meter expires in 5 minutes!',
        severity: 'critical',
      },
      {
        beforeMinutes: 0,
        message: 'Meter EXPIRED!',
        severity: 'critical',
      },
    ],
  },
};

// =============================================================================
// SF-Specific Fine Amounts
// =============================================================================

export const sfFines = {
  streetCleaning: 79,
  expiredMeter: 99,
  wheelsNotCurbed: 61,
  towAwayZone: 122,
  blockingDriveway: 122,
  fireHydrant: 122,
  seventyTwoHour: 74,
  redZone: 122,
  yellowZone: 122,
  whiteZone: 122,
  blueZone: 900, // Disabled zone violation!
  greenZone: 74,
};

// =============================================================================
// SF Tow Fees - Among the highest in the US
// =============================================================================

export const sfTowFees = {
  towFee: 550,
  storageFeePerDay: 75,
  adminFee: 290,
  ticketFine: 122, // Tow-away zone violation
  totalFirstDay: 1037, // Approximate total
};

// =============================================================================
// SF Unique Rules
// =============================================================================

export const sfUniqueRules = {
  // Text Before Tow program
  textBeforeTow: {
    description: 'Opt-in to get text warning before tow for certain violations',
    appliesTo: [
      '72-hour',
      'blocked-driveway',
      'construction',
      'temp-no-parking',
    ],
    doesNotApply: ['tow-away-lanes', 'color-curb'],
    signupUrl: 'https://www.sfmta.com/text-tow-program-application',
  },

  // Curb your wheels
  curbWheels: {
    uphill: 'Turn wheels away from curb',
    downhill: 'Turn wheels into curb',
    noExemptionForFlat: false, // Only required on 3%+ grade
  },

  // Meter holidays - very limited
  meterHolidays: {
    days: ['Thanksgiving', 'Christmas', "New Year's Day"],
    description: 'Only 3 days when meters are free',
  },

  // Residential permit areas
  permitAreas: {
    count: 31,
    format: 'A-Z, AA-FF',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if currently in tow zone hours
 */
export function isCurrentlyTowZoneHours(): boolean {
  const now = new Date();
  const day = now.getDay();

  // Only weekdays
  if (day === 0 || day === 6) return false;

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  const morning = sfAlertRules.commuteHourTowZone.morningWindow;
  const evening = sfAlertRules.commuteHourTowZone.eveningWindow;

  // Check morning window
  if (timeStr >= morning.start && timeStr < morning.end) {
    return true;
  }

  // Check evening window
  if (timeStr >= evening.start && timeStr < evening.end) {
    return true;
  }

  return false;
}

/**
 * Get time until next tow zone activation
 */
export function getMinutesUntilTowZone(): number | null {
  const now = new Date();
  const day = now.getDay();

  // Only weekdays
  if (day === 0 || day === 6) {
    // Next Monday morning
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    const nextMonday = new Date(now);
    nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
    nextMonday.setHours(7, 0, 0, 0);
    return Math.round((nextMonday.getTime() - now.getTime()) / 60000);
  }

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

  const morning = sfAlertRules.commuteHourTowZone.morningWindow;
  const evening = sfAlertRules.commuteHourTowZone.eveningWindow;

  // Before morning window
  if (timeStr < morning.start) {
    const [startHour, startMin] = morning.start.split(':').map(Number);
    const startTime = new Date(now);
    startTime.setHours(startHour, startMin, 0, 0);
    return Math.round((startTime.getTime() - now.getTime()) / 60000);
  }

  // After morning, before evening
  if (timeStr >= morning.end && timeStr < evening.start) {
    const [startHour, startMin] = evening.start.split(':').map(Number);
    const startTime = new Date(now);
    startTime.setHours(startHour, startMin, 0, 0);
    return Math.round((startTime.getTime() - now.getTime()) / 60000);
  }

  // After evening - next day's morning
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Skip weekend
  if (tomorrow.getDay() === 0) {
    tomorrow.setDate(tomorrow.getDate() + 1); // Skip to Monday
  } else if (tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 2); // Skip to Monday
  }

  tomorrow.setHours(7, 0, 0, 0);
  return Math.round((tomorrow.getTime() - now.getTime()) / 60000);
}

/**
 * Get curb wheel direction for a grade
 */
export function getCurbWheelDirection(
  gradePercent: number,
  isUphill: boolean
): string {
  if (Math.abs(gradePercent) < sfAlertRules.curbWheelsReminder.gradeThreshold) {
    return 'No curbing required - grade under 3%';
  }

  if (isUphill) {
    return 'Turn wheels AWAY from curb (so car rolls back into curb if brakes fail)';
  } else {
    return 'Turn wheels INTO curb (so car rolls into curb if brakes fail)';
  }
}

/**
 * Check if street is a known tow zone
 */
export function isKnownTowZone(streetName: string): boolean {
  return SF_COMMUTE_TOW_ZONES.some((zone) =>
    zone.streets.some((s) => streetName.toLowerCase().includes(s.toLowerCase()))
  );
}

export default {
  sfAlertRules,
  sfFines,
  sfTowFees,
  sfUniqueRules,
  isCurrentlyTowZoneHours,
  getMinutesUntilTowZone,
  getCurbWheelDirection,
  isKnownTowZone,
};
