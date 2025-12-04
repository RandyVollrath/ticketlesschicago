// ===========================================
// SnowSOS Configuration Constants
// ===========================================

// Job Lifecycle Timeouts (in minutes)
export const JOB_TIMEOUTS = {
  // Time allowed after accepting before plower must tap "On the way"
  ACCEPT_TO_ON_THE_WAY_MINUTES: 10,
  // Time allowed after "On the way" before plower must arrive
  ON_THE_WAY_TO_ARRIVED_MINUTES: 60,
  // Auto-complete time after job is started (fallback)
  AUTO_COMPLETE_HOURS: 2,
} as const;

// Reliability & Suspension
export const RELIABILITY = {
  // Number of no-show strikes before suspension
  MAX_NO_SHOW_STRIKES: 3,
  // Minimum reliability score for Diamond tier
  DIAMOND_RELIABILITY_THRESHOLD: 0.9,
} as const;

// Tier Thresholds (jobs completed)
export const TIER_THRESHOLDS = {
  BRONZE_MAX: 9,
  SILVER_MIN: 10,
  SILVER_MAX: 49,
  GOLD_MIN: 50,
  GOLD_MAX: 99,
  DIAMOND_MIN: 100,
} as const;

// Bonuses
export const BONUS_AMOUNTS = {
  // Bonus for claiming within N seconds of broadcast
  FAST_RESPONSE: 5,
  // Time window to qualify for fast response bonus (seconds)
  FAST_RESPONSE_WINDOW_SECONDS: 30,
  // First job completion bonus
  FIRST_JOB: 10,
} as const;

// Matching
export const MATCHING = {
  // Maximum distance for job matching (miles)
  MAX_DISTANCE_MILES: 15,
  // Default radius for Chicago + suburbs
  CHICAGOLAND_RADIUS_MILES: 15,
} as const;

// Platform Fees
export const FEES = {
  // Platform fee percentage (0.10 = 10%)
  PLATFORM_FEE_PERCENT: 0.10,
} as const;

// SMS/Push Templates
export const NOTIFICATION_TEMPLATES = {
  JOB_ACCEPTED: (address: string, plowerName: string) =>
    `SnowSOS: ${plowerName || "A plower"} has accepted your job at ${address}! They'll be on their way soon.`,
  JOB_ON_THE_WAY: (plowerName: string) =>
    `SnowSOS: ${plowerName || "Your plower"} is on the way!`,
  JOB_ARRIVED: () =>
    `SnowSOS: Your plower has arrived and started working!`,
  JOB_COMPLETED: (amount: number) =>
    `SnowSOS: Job complete! Please pay $${amount} to your plower. Reply REVIEW to rate them.`,
  JOB_REASSIGNED: () =>
    `SnowSOS: Your job has been reassigned to a new plower. We apologize for the delay.`,
  PLOWER_SUSPENDED: () =>
    `SnowSOS: Your account has been temporarily suspended due to repeated no-shows. Contact support to appeal.`,
} as const;

// Cron Job Intervals
export const CRON = {
  // How often to check for stale jobs (ms)
  STALE_JOB_CHECK_INTERVAL_MS: 2 * 60 * 1000, // 2 minutes
  // How early to broadcast scheduled jobs (minutes before)
  SCHEDULED_JOB_BROADCAST_MINUTES: 60,
} as const;

// ===========================================
// Round 2: Storm Mode & Surge Pricing
// ===========================================

export const STORM_SURGE = {
  // Snowfall thresholds for surge pricing (inches)
  LIGHT_THRESHOLD: 4,
  MODERATE_THRESHOLD: 6,
  HEAVY_THRESHOLD: 10,
  // Surge multipliers
  LIGHT_MULTIPLIER: 1.2,
  MODERATE_MULTIPLIER: 1.5,
  HEAVY_MULTIPLIER: 2.0,
} as const;

// Calculate surge multiplier based on forecast inches
export function calculateSurgeMultiplier(inches: number): number {
  if (inches >= STORM_SURGE.HEAVY_THRESHOLD) return STORM_SURGE.HEAVY_MULTIPLIER;
  if (inches >= STORM_SURGE.MODERATE_THRESHOLD) return STORM_SURGE.MODERATE_MULTIPLIER;
  if (inches >= STORM_SURGE.LIGHT_THRESHOLD) return STORM_SURGE.LIGHT_MULTIPLIER;
  return 1.0;
}

// ===========================================
// Round 2: Cancellation & Backup
// ===========================================

export const CANCELLATION = {
  // Default cancellation fee when customer cancels after acceptance
  DEFAULT_FEE: 20,
} as const;

export const BACKUP_PLOWER = {
  // Bonus for backup plower when promoted
  ACTIVATION_BONUS: 10,
} as const;

// ===========================================
// Round 2: Referrals
// ===========================================

export const REFERRALS = {
  // Customer referral credit
  CUSTOMER_SIGNUP_CREDIT: 15,
  // Plower referral bonus (after 5 jobs completed)
  PLOWER_MILESTONE_BONUS: 25,
  // Jobs required for plower referral payout
  PLOWER_MILESTONE_JOBS: 5,
} as const;

// ===========================================
// Round 2: Notification Templates
// ===========================================

export const STORM_NOTIFICATIONS = {
  STORM_MODE_ACTIVATED: (multiplier: number) =>
    `❄️ Storm Mode Activated — ${multiplier}x surge pricing + bonuses active. Go online now!`,
  BACKUP_PROMOTED: (address: string, bonus: number) =>
    `SnowSOS: You've been promoted from backup! Job at ${address} is now yours (+$${bonus} bonus).`,
  CUSTOMER_BACKUP_PROMOTED: () =>
    `SnowSOS: Your original plower didn't arrive. We've assigned your backup plower who is on the way.`,
  CANCELLATION_FEE_OWED: (fee: number) =>
    `SnowSOS: Customer canceled — You are owed a $${fee} cancellation fee.`,
  SCHEDULED_JOB_BROADCAST: (address: string, time: string) =>
    `SnowSOS: Scheduled job at ${address} for ${time} is now available to claim!`,
  SCHEDULED_JOB_REMINDER: (time: string) =>
    `SnowSOS: Your scheduled job is being matched with plowers. Expected time: ${time}`,
} as const;
