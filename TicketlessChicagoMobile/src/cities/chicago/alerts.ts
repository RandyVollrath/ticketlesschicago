/**
 * Chicago Alert Rules
 *
 * City-specific alert configurations for Chicago parking.
 *
 * Key Chicago rules:
 * - Snow emergency (2" ban) - highest priority
 * - Winter overnight ban (Dec 1 - Apr 1, 3am-7am)
 * - Street cleaning (April-November)
 */

// =============================================================================
// Types
// =============================================================================

export interface AlertTimeConfig {
  beforeMinutes: number;
  message: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface AlertRuleConfig {
  enabled: boolean;
  checkFrequency?: string;
  alertTimes: AlertTimeConfig[];
  sources?: string[];
}

export interface ChicagoAlertRules {
  snowEmergency: AlertRuleConfig;
  winterOvernightBan: AlertRuleConfig;
  twoInchSnowBan: AlertRuleConfig;
  streetCleaning: AlertRuleConfig;
}

// =============================================================================
// Chicago Alert Rules
// =============================================================================

export const chicagoAlertRules: ChicagoAlertRules = {
  // Snow emergency - HIGHEST PRIORITY
  snowEmergency: {
    enabled: true,
    checkFrequency: 'every-5-minutes', // Check frequently in winter
    sources: [
      'https://www.chicago.gov/snow', // Official source
      '@ChicagoDOT', // Twitter/X
    ],
    alertTimes: [
      {
        beforeMinutes: 60,
        message: 'Chicago Snow Emergency declared! Move off snow routes within 1 hour.',
        severity: 'critical',
      },
      {
        beforeMinutes: 30,
        message: 'Snow emergency enforcement starts in 30 minutes - MOVE NOW!',
        severity: 'critical',
      },
      {
        beforeMinutes: 0, // Active
        message: 'Snow emergency IN EFFECT - Move immediately or risk $150 ticket + tow!',
        severity: 'critical',
      },
    ],
  },

  // Winter overnight ban (Dec 1 - Apr 1, 3am-7am)
  winterOvernightBan: {
    enabled: true,
    alertTimes: [
      {
        beforeMinutes: 120,
        message: 'Overnight parking ban starts in 2 hours (3am-7am)',
        severity: 'info',
      },
      {
        beforeMinutes: 60,
        message: 'Overnight parking ban starts in 1 hour',
        severity: 'warning',
      },
      {
        beforeMinutes: 30,
        message: 'Overnight parking ban starts in 30 minutes - move your car!',
        severity: 'critical',
      },
      {
        beforeMinutes: 15,
        message: 'OVERNIGHT BAN in 15 minutes - MOVE NOW!',
        severity: 'critical',
      },
    ],
  },

  // 2-inch snow ban
  twoInchSnowBan: {
    enabled: true,
    checkFrequency: 'every-15-minutes', // Check during snowfall
    alertTimes: [
      {
        beforeMinutes: 0, // Active when 2"+ snow falls
        message: '2"+ snow has fallen - parking banned on snow routes until plowed',
        severity: 'critical',
      },
    ],
  },

  // Street cleaning (April-November)
  streetCleaning: {
    enabled: true,
    alertTimes: [
      {
        beforeMinutes: 720, // 12 hours
        message: 'Street cleaning tomorrow - check your schedule',
        severity: 'info',
      },
      {
        beforeMinutes: 120,
        message: 'Street cleaning in 2 hours',
        severity: 'info',
      },
      {
        beforeMinutes: 60,
        message: 'Street cleaning in 1 hour - move your car',
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
};

// =============================================================================
// Chicago-Specific Fine Amounts
// =============================================================================

export const chicagoFines = {
  streetCleaning: 65,
  expiredMeter: 65,
  noCitySticker: 200,
  doubleParking: 100,
  fireHydrant: 150,
  overtimeParking: 65,
  snowRouteViolation: 150,
  overnightBan: 65,
};

// =============================================================================
// Chicago Tow Fees
// =============================================================================

export const chicagoTowFees = {
  towFee: 205,
  storageFeePerDay: 25,
  releaseFee: 60,
  // Total first day: ~$290 + ticket
};

// =============================================================================
// Chicago Seasonal Rules
// =============================================================================

export const chicagoSeasonalRules = {
  streetCleaning: {
    season: { start: '04-01', end: '11-30' },
    typicalStartTime: '09:00',
    typicalEndTime: '15:00', // Actually 2pm per spec
  },
  winterOvernightBan: {
    season: { start: '12-01', end: '04-01' },
    hours: { start: '03:00', end: '07:00' },
    affectedRoutes: 'Designated snow routes',
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if we're in street cleaning season
 */
export function isStreetCleaningSeason(date: Date = new Date()): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dateValue = month * 100 + day;

  const startValue = 401; // April 1
  const endValue = 1130; // November 30

  return dateValue >= startValue && dateValue <= endValue;
}

/**
 * Check if we're in winter overnight ban season
 */
export function isWinterBanSeason(date: Date = new Date()): boolean {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dateValue = month * 100 + day;

  // Dec 1 to Apr 1 (wraps around year)
  const startValue = 1201; // December 1
  const endValue = 401; // April 1

  return dateValue >= startValue || dateValue <= endValue;
}

/**
 * Check if we're within overnight ban hours
 */
export function isWithinOvernightBanHours(date: Date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 3 && hour < 7;
}

/**
 * Get appropriate alert message for a Chicago restriction
 */
export function getChicagoAlertMessage(
  restrictionType: string,
  minutesUntil: number
): string {
  const rules = chicagoAlertRules[restrictionType as keyof ChicagoAlertRules];
  if (!rules) return 'Parking restriction';

  // Find the appropriate message based on time
  for (const alertTime of [...rules.alertTimes].sort(
    (a, b) => b.beforeMinutes - a.beforeMinutes
  )) {
    if (minutesUntil <= alertTime.beforeMinutes) {
      return alertTime.message;
    }
  }

  return 'Parking restriction';
}

export default {
  chicagoAlertRules,
  chicagoFines,
  chicagoTowFees,
  chicagoSeasonalRules,
  isStreetCleaningSeason,
  isWinterBanSeason,
  isWithinOvernightBanHours,
  getChicagoAlertMessage,
};
