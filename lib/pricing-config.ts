/**
 * Centralized Pricing Configuration
 * Single source of truth for all pricing in the application
 *
 * NOTE: Actual Stripe prices are fetched from Stripe using price IDs in stripe-config.ts
 * This file contains fee constants and display values for consistency across UI
 */

// ==========================================
// SUBSCRIPTION PRICING (Display values)
// Actual charges use Stripe price IDs
// ==========================================
export const SUBSCRIPTION_PRICING = {
  monthly: {
    amount: 8,
    displayAmount: '$8',
    interval: 'month',
    stripePriceEnvKey: 'STRIPE_PROTECTION_MONTHLY_PRICE_ID',
  },
  annual: {
    amount: 80,
    displayAmount: '$80',
    interval: 'year',
    stripePriceEnvKey: 'STRIPE_PROTECTION_ANNUAL_PRICE_ID',
    savings: '$16', // 2 months free
  },
} as const;

// ==========================================
// PLATFORM FEES (Charged by us)
// ==========================================
export const PLATFORM_FEES = {
  // Service fee added to each renewal transaction
  // Covers operational costs (processing, infrastructure)
  SERVICE_FEE: 2.50,

  // Remitter processing fee (paid from subscription revenue)
  // Sent to remitter for each renewal they process
  REMITTER_SERVICE_FEE: 6.00,

  // Residential parking permit filing fee
  PERMIT_FEE: 30.00,
} as const;

// ==========================================
// STRIPE PROCESSING FEES (Their cut)
// ==========================================
export const STRIPE_FEES = {
  PERCENTAGE_FEE: 0.029, // 2.9%
  FIXED_FEE: 0.30, // $0.30 per transaction
} as const;

// ==========================================
// CITY STICKER PRICING (Chicago 2025)
// Official prices from chicityclerk.com
// ==========================================
export const CITY_STICKER_PRICES = {
  // Motorcycles and motorized bicycles
  MB: { amount: 53.04, displayAmount: '$53.04', label: 'Motorcycle/Motorized Bicycle' },

  // Passenger vehicles (most common) - ≤4,500 lbs curb weight, ≤2,499 lbs payload
  P: { amount: 100.17, displayAmount: '$100.17', label: 'Passenger Vehicle' },

  // Large passenger vehicles - ≥4,501 lbs curb weight, ≤2,499 lbs payload
  LP: { amount: 159.12, displayAmount: '$159.12', label: 'Large Passenger Vehicle' },

  // Small trucks - ≤16,000 lbs or ≥2,500 lbs payload
  ST: { amount: 235.71, displayAmount: '$235.71', label: 'Small Truck' },

  // Large trucks - ≥16,001 lbs or ≥2,500 lbs payload
  LT: { amount: 530.40, displayAmount: '$530.40', label: 'Large Truck' },
} as const;

// ==========================================
// LICENSE PLATE PRICING (Illinois SOS 2025)
// Official fees from ilsos.gov
// ==========================================

// License plate type definitions for UI
export type LicensePlateType =
  | 'passenger_standard' | 'passenger_personalized' | 'passenger_vanity'
  | 'motorcycle_standard' | 'motorcycle_personalized' | 'motorcycle_vanity'
  | 'btruck_standard' | 'btruck_personalized' | 'btruck_vanity'
  | 'ctruck'
  | 'disability_standard' | 'disability_personalized' | 'disability_vanity';

export const LICENSE_PLATE_TYPE_INFO: Record<LicensePlateType, {
  label: string;
  description: string;
  totalRenewal: number;
  category: string;
}> = {
  // Passenger vehicles
  passenger_standard: {
    label: 'Passenger - Standard',
    description: 'Regular passenger vehicle plates',
    totalRenewal: 151,
    category: 'Passenger',
  },
  passenger_personalized: {
    label: 'Passenger - Personalized',
    description: 'Passenger plates with letters AND numbers',
    totalRenewal: 158,
    category: 'Passenger',
  },
  passenger_vanity: {
    label: 'Passenger - Vanity',
    description: 'Passenger plates with letters only or numbers only',
    totalRenewal: 164,
    category: 'Passenger',
  },
  // Motorcycle
  motorcycle_standard: {
    label: 'Motorcycle - Standard',
    description: 'Regular motorcycle plates',
    totalRenewal: 41,
    category: 'Motorcycle',
  },
  motorcycle_personalized: {
    label: 'Motorcycle - Personalized',
    description: 'Motorcycle plates with letters AND numbers',
    totalRenewal: 48,
    category: 'Motorcycle',
  },
  motorcycle_vanity: {
    label: 'Motorcycle - Vanity',
    description: 'Motorcycle plates with letters only or numbers only',
    totalRenewal: 54,
    category: 'Motorcycle',
  },
  // B-Truck
  btruck_standard: {
    label: 'B-Truck - Standard',
    description: 'Light truck plates (8,000 lbs or less)',
    totalRenewal: 151,
    category: 'B-Truck',
  },
  btruck_personalized: {
    label: 'B-Truck - Personalized',
    description: 'B-Truck plates with letters AND numbers',
    totalRenewal: 158,
    category: 'B-Truck',
  },
  btruck_vanity: {
    label: 'B-Truck - Vanity',
    description: 'B-Truck plates with letters only or numbers only',
    totalRenewal: 164,
    category: 'B-Truck',
  },
  // C-Truck
  ctruck: {
    label: 'C-Truck - Standard',
    description: 'Medium truck plates (8,001-16,000 lbs)',
    totalRenewal: 218,
    category: 'C-Truck',
  },
  // Persons with Disabilities
  disability_standard: {
    label: 'Disability - Standard',
    description: 'Persons with disabilities plates',
    totalRenewal: 151,
    category: 'Disability',
  },
  disability_personalized: {
    label: 'Disability - Personalized',
    description: 'Disability plates with letters AND numbers',
    totalRenewal: 158,
    category: 'Disability',
  },
  disability_vanity: {
    label: 'Disability - Vanity',
    description: 'Disability plates with letters only or numbers only',
    totalRenewal: 164,
    category: 'Disability',
  },
} as const;

// Legacy constants for backward compatibility
export const LICENSE_PLATE_PRICES = {
  BASE_RENEWAL: { amount: 151, displayAmount: '$151', label: 'Registration Renewal' },
  VANITY_ADDITIONAL: { amount: 13, displayAmount: '+$13', label: 'Vanity Plate Fee' },
  PERSONALIZED_ADDITIONAL: { amount: 7, displayAmount: '+$7', label: 'Personalized Plate Fee' },
} as const;

// ==========================================
// TICKET AMOUNTS (For display/warnings)
// ==========================================
export const TICKET_AMOUNTS = {
  STREET_CLEANING: { amount: 75, displayAmount: '$75' },
  EXPIRED_STICKER: { amount: 200, displayAmount: '$200' },
  EXPIRED_PLATES: { amount: 100, displayAmount: '$100+' },
  NO_PERMIT: { amount: 75, displayAmount: '$75' },
  SNOW_BAN_TICKET: { amount: 60, displayAmount: '$60' },
  SNOW_BAN_TOW: { amount: 150, displayAmount: '$150' },
  SNOW_BAN_STORAGE_PER_DAY: { amount: 25, displayAmount: '$25/day' },
} as const;

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Calculate total charge amount including Stripe fees
 * So we receive the exact base amount after Stripe takes their cut
 */
export function calculateTotalWithStripeFees(baseAmount: number): number {
  const total = (baseAmount + STRIPE_FEES.FIXED_FEE) / (1 - STRIPE_FEES.PERCENTAGE_FEE);
  return Math.round(total * 100) / 100;
}

/**
 * Get display price for city sticker by vehicle type
 */
export function getCityStickerDisplayPrice(vehicleType: keyof typeof CITY_STICKER_PRICES): string {
  return CITY_STICKER_PRICES[vehicleType]?.displayAmount || CITY_STICKER_PRICES.P.displayAmount;
}

/**
 * Format cents to dollars display
 */
export function formatCentsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Format dollars to display string
 */
export function formatDollars(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Get license plate renewal cost by plate type
 */
export function getLicensePlateRenewalCost(plateType: LicensePlateType): number {
  return LICENSE_PLATE_TYPE_INFO[plateType]?.totalRenewal || LICENSE_PLATE_PRICES.BASE_RENEWAL.amount;
}

/**
 * Get license plate renewal cost with service fee
 */
export function getLicensePlateRenewalCostWithFee(plateType: LicensePlateType): number {
  return getLicensePlateRenewalCost(plateType) + PLATFORM_FEES.SERVICE_FEE;
}
