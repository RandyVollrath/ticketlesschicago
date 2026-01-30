/**
 * NYC Alert Rules
 *
 * City-specific alert configurations for New York City parking.
 *
 * Key NYC rules:
 * - Alternate Side Parking (ASP) with 30+ holiday suspensions
 * - Real-time ASP suspension checking
 * - Muni-meter expiration
 */

import { isASPSuspended, NYC_ASP_CALENDAR_2026 } from './holidays';

// =============================================================================
// Types
// =============================================================================

export interface AlertTimeConfig {
  beforeMinutes: number;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface NYCAlertRules {
  alternateSideParking: {
    enabled: boolean;
    checkFrequency: string;
    suspensionSources: string[];
    alertTimes: AlertTimeConfig[];
    typicalDuration: number;
  };
  muniMeter: {
    enabled: boolean;
    alertTimes: AlertTimeConfig[];
  };
  holidaySuspensions: {
    enabled: boolean;
    showUpcoming: boolean;
    daysAhead: number;
  };
  doubleParking: {
    alwaysIllegal: boolean;
    fine: number;
    towRisk: boolean;
  };
}

// =============================================================================
// NYC Alert Rules
// =============================================================================

export const nycAlertRules: NYCAlertRules = {
  // Alternate side parking - THE BIG ONE
  alternateSideParking: {
    enabled: true,
    checkFrequency: 'hourly',
    suspensionSources: [
      '@NYCASP', // Official Twitter
      'https://www.nyc.gov/asp', // Official site
    ],
    typicalDuration: 90, // 1.5 hours
    alertTimes: [
      {
        beforeMinutes: 720, // 12 hours
        message: 'Alternate side parking tomorrow',
        severity: 'info',
      },
      {
        beforeMinutes: 120,
        message: 'ASP starts in 2 hours - plan to move',
        severity: 'info',
      },
      {
        beforeMinutes: 60,
        message: 'ASP starts in 1 hour - move to other side',
        severity: 'warning',
      },
      {
        beforeMinutes: 30,
        message: 'ASP in 30 minutes!',
        severity: 'warning',
      },
      {
        beforeMinutes: 15,
        message: 'ASP in 15 MINUTES - MOVE NOW!',
        severity: 'critical',
      },
    ],
  },

  // Muni-meter expiration
  muniMeter: {
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
        message: 'Meter EXPIRED - add time or move!',
        severity: 'critical',
      },
    ],
  },

  // Holiday suspension notifications
  holidaySuspensions: {
    enabled: true,
    showUpcoming: true,
    daysAhead: 7, // Show upcoming holidays
  },

  // Double parking - ALWAYS illegal
  doubleParking: {
    alwaysIllegal: true,
    fine: 115,
    towRisk: true,
  },
};

// =============================================================================
// NYC-Specific Fine Amounts
// =============================================================================

export const nycFines = {
  streetCleaning: 65,
  expiredMeter: 65,
  failingToShowReceipt: 65,
  fireHydrant: 115,
  doubleParking: 115,
  noStandingExceptTrucks: 95,
  expiredRegistration: 65,
  inspectionStickerMissing: 65,
  busLane: 115,
  bikeLane: 115,
  crosswalk: 115,
};

// =============================================================================
// NYC Tow Fees (varies by borough)
// =============================================================================

export const nycTowFees = {
  manhattan: {
    towFee: 185,
    storageFeePerDay: 20,
  },
  outerBoroughs: {
    towFee: 185,
    storageFeePerDay: 15,
  },
};

// =============================================================================
// NYC Unique Rules
// =============================================================================

export const nycUniqueRules = {
  // T-intersection exception
  tIntersectionException: {
    description: 'Can park at T-intersections without signals, even at curb cuts',
    caveat: 'Does not apply if there is a traffic signal',
  },

  // Muni-meter system
  muniMeterSystem: {
    description: 'Pay at meter, place receipt on dashboard',
    maxTime: 120, // Typical max, varies by location
  },

  // ASP double parking is NOT allowed
  aspDoubleParking: {
    allowed: false,
    description: 'Double parking illegal at ALL times, even during street cleaning',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if ASP is suspended today
 */
export function isASPSuspendedToday(): { suspended: boolean; reason?: string } {
  const today = new Date();
  const holiday = isASPSuspended(today);

  if (holiday) {
    return {
      suspended: true,
      reason: holiday.holiday,
    };
  }

  return { suspended: false };
}

/**
 * Get upcoming ASP holidays
 */
export function getUpcomingASPHolidays(count: number = 5) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return NYC_ASP_CALENDAR_2026.filter((h) => h.date >= todayStr).slice(0, count);
}

/**
 * Get alert message with suspension check
 */
export async function getASPAlertMessage(
  minutesUntil: number
): Promise<{ message: string; severity: string; suspended: boolean }> {
  const suspensionStatus = isASPSuspendedToday();

  if (suspensionStatus.suspended) {
    return {
      message: `ASP SUSPENDED today - ${suspensionStatus.reason}. No need to move!`,
      severity: 'info',
      suspended: true,
    };
  }

  // Find appropriate message
  const rules = nycAlertRules.alternateSideParking;
  for (const alertTime of [...rules.alertTimes].sort(
    (a, b) => b.beforeMinutes - a.beforeMinutes
  )) {
    if (minutesUntil <= alertTime.beforeMinutes) {
      return {
        message: alertTime.message,
        severity: alertTime.severity,
        suspended: false,
      };
    }
  }

  return {
    message: 'Alternate side parking today',
    severity: 'info',
    suspended: false,
  };
}

/**
 * Get count of ASP suspension days per year
 */
export function getASPSuspensionDaysCount(): number {
  return NYC_ASP_CALENDAR_2026.filter((h) => h.aspSuspended).length;
}

/**
 * Format NYC borough name
 */
export function formatBoroughName(borough: string): string {
  const boroughNames: Record<string, string> = {
    manhattan: 'Manhattan',
    brooklyn: 'Brooklyn',
    queens: 'Queens',
    bronx: 'The Bronx',
    'staten-island': 'Staten Island',
  };
  return boroughNames[borough] || borough;
}

export default {
  nycAlertRules,
  nycFines,
  nycTowFees,
  nycUniqueRules,
  isASPSuspendedToday,
  getUpcomingASPHolidays,
  getASPAlertMessage,
  getASPSuspensionDaysCount,
  formatBoroughName,
};
