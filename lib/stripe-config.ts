/**
 * Stripe Configuration Helper
 * Automatically uses test or live keys based on STRIPE_MODE environment variable
 */

const isTestMode = process.env.STRIPE_MODE === 'test';

export const stripeConfig = {
  // Secret key for server-side operations
  secretKey: isTestMode
    ? process.env.STRIPE_TEST_SECRET_KEY
    : process.env.STRIPE_SECRET_KEY || process.env.STRIPE_LIVE_SECRET_KEY,

  // Publishable key for client-side operations
  publishableKey: isTestMode
    ? process.env.STRIPE_TEST_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.STRIPE_LIVE_PUBLISHABLE_KEY,

  // Webhook secret
  webhookSecret: isTestMode
    ? process.env.STRIPE_TEST_WEBHOOK_SECRET
    : process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_LIVE_WEBHOOK_SECRET,

  // Subscription price IDs
  protectionMonthlyPriceId: isTestMode
    ? process.env.STRIPE_TEST_PROTECTION_MONTHLY_PRICE_ID
    : process.env.STRIPE_PROTECTION_MONTHLY_PRICE_ID || process.env.STRIPE_LIVE_PROTECTION_MONTHLY_PRICE_ID,

  protectionAnnualPriceId: isTestMode
    ? process.env.STRIPE_TEST_PROTECTION_ANNUAL_PRICE_ID
    : process.env.STRIPE_PROTECTION_ANNUAL_PRICE_ID || process.env.STRIPE_LIVE_PROTECTION_ANNUAL_PRICE_ID,

  // City sticker price IDs by vehicle type
  cityStickerMbPriceId: isTestMode
    ? process.env.STRIPE_TEST_CITY_STICKER_MB_PRICE_ID
    : process.env.STRIPE_CITY_STICKER_MB_PRICE_ID || process.env.STRIPE_LIVE_CITY_STICKER_MB_PRICE_ID,

  cityStickerPPriceId: isTestMode
    ? process.env.STRIPE_TEST_CITY_STICKER_P_PRICE_ID
    : process.env.STRIPE_CITY_STICKER_P_PRICE_ID || process.env.STRIPE_LIVE_CITY_STICKER_P_PRICE_ID,

  cityStickerLpPriceId: isTestMode
    ? process.env.STRIPE_TEST_CITY_STICKER_LP_PRICE_ID
    : process.env.STRIPE_CITY_STICKER_LP_PRICE_ID || process.env.STRIPE_LIVE_CITY_STICKER_LP_PRICE_ID,

  cityStickerStPriceId: isTestMode
    ? process.env.STRIPE_TEST_CITY_STICKER_ST_PRICE_ID
    : process.env.STRIPE_CITY_STICKER_ST_PRICE_ID || process.env.STRIPE_LIVE_CITY_STICKER_ST_PRICE_ID,

  cityStickerLtPriceId: isTestMode
    ? process.env.STRIPE_TEST_CITY_STICKER_LT_PRICE_ID
    : process.env.STRIPE_CITY_STICKER_LT_PRICE_ID || process.env.STRIPE_LIVE_CITY_STICKER_LT_PRICE_ID,

  // License plate price IDs
  licensePlatePriceId: isTestMode
    ? process.env.STRIPE_TEST_LICENSE_PLATE_PRICE_ID
    : process.env.STRIPE_LICENSE_PLATE_PRICE_ID || process.env.STRIPE_LIVE_LICENSE_PLATE_PRICE_ID,

  licensePlateVanityPriceId: isTestMode
    ? process.env.STRIPE_TEST_LICENSE_PLATE_VANITY_PRICE_ID
    : process.env.STRIPE_LICENSE_PLATE_VANITY_PRICE_ID || process.env.STRIPE_LIVE_LICENSE_PLATE_VANITY_PRICE_ID,

  // Permit fee price ID
  permitFeePriceId: isTestMode
    ? process.env.STRIPE_TEST_PERMIT_FEE_PRICE_ID
    : process.env.STRIPE_PERMIT_FEE_PRICE_ID || process.env.STRIPE_LIVE_PERMIT_FEE_PRICE_ID,

  // Remitter setup fee (one-time $12 charge sent to remitter via Connect)
  remitterSetupFeePriceId: isTestMode
    ? process.env.STRIPE_TEST_REMITTER_SETUP_FEE_PRICE_ID
    : process.env.STRIPE_REMITTER_SETUP_FEE_PRICE_ID || process.env.STRIPE_LIVE_REMITTER_SETUP_FEE_PRICE_ID,

  // Mode indicator
  isTestMode,
  mode: isTestMode ? 'test' : 'live',
};

// Log which mode we're using on server startup
if (typeof window === 'undefined') {
  console.log(`🔑 Stripe Mode: ${stripeConfig.mode.toUpperCase()}`);
  if (isTestMode) {
    console.log('⚠️  Using TEST mode - no real charges will be made');
  }
}

export default stripeConfig;
