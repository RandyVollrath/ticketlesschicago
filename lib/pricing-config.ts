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
    amount: 12,
    displayAmount: '$12',
    interval: 'month',
    stripePriceEnvKey: 'STRIPE_PROTECTION_MONTHLY_PRICE_ID',
  },
  annual: {
    amount: 120,
    displayAmount: '$120',
    interval: 'year',
    stripePriceEnvKey: 'STRIPE_PROTECTION_ANNUAL_PRICE_ID',
    savings: '$24', // 2 months free
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
  REMITTER_SERVICE_FEE: 12.00,

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
// CITY STICKER PRICING (Chicago 2024-2025)
// These are the actual costs the city charges
// Our Stripe prices should match these
// ==========================================
export const CITY_STICKER_PRICES = {
  // Motorcycles and motorized bicycles
  MB: { amount: 75, displayAmount: '$75', label: 'Motorcycle/Motorized Bicycle' },

  // Passenger vehicles (most common)
  P: { amount: 151, displayAmount: '$151', label: 'Passenger Vehicle' },

  // Large passenger vehicles (SUVs, vans)
  LP: { amount: 151, displayAmount: '$151', label: 'Large Passenger Vehicle' },

  // Small trucks (under 4,500 lbs)
  ST: { amount: 151, displayAmount: '$151', label: 'Small Truck' },

  // Large trucks (4,500+ lbs)
  LT: { amount: 151, displayAmount: '$151', label: 'Large Truck' },
} as const;

// ==========================================
// LICENSE PLATE PRICING (Illinois SOS 2024-2025)
// ==========================================
export const LICENSE_PLATE_PRICES = {
  // Standard registration renewal
  STANDARD: { amount: 151, displayAmount: '$151', label: 'Standard Renewal' },

  // Vanity/personalized plate additional fee
  VANITY_ADDITIONAL: { amount: 13, displayAmount: '+$13', label: 'Vanity Plate Fee' },

  // Personalized plate fee
  PERSONALIZED_ADDITIONAL: { amount: 7, displayAmount: '+$7', label: 'Personalized Plate Fee' },
} as const;

// ==========================================
// TICKET AMOUNTS (For display/warnings)
// ==========================================
export const TICKET_AMOUNTS = {
  STREET_CLEANING: { amount: 75, displayAmount: '$75' },
  EXPIRED_STICKER: { amount: 200, displayAmount: '$200' },
  EXPIRED_PLATES: { amount: 120, displayAmount: '$120' },
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
