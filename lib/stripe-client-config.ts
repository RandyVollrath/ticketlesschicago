/**
 * Stripe Client Configuration
 * For use in browser/client-side code only
 *
 * Note: NEXT_PUBLIC_ env vars are embedded at build time,
 * so you need to rebuild after changing STRIPE_MODE
 */

// Check if we're in test mode (embedded at build time)
const isTestMode = process.env.NEXT_PUBLIC_STRIPE_MODE === 'test';

// Get the publishable key based on mode
export const getStripePublishableKey = (): string => {
  const key = isTestMode
    ? process.env.NEXT_PUBLIC_STRIPE_TEST_PUBLISHABLE_KEY
    : process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  if (!key) {
    console.error(`Stripe publishable key not found for mode: ${isTestMode ? 'test' : 'live'}`);
    throw new Error('Stripe publishable key not configured');
  }

  return key;
};

// Log mode info (only in browser)
if (typeof window !== 'undefined') {
  console.log(`🔑 Stripe Client Mode: ${isTestMode ? 'TEST' : 'LIVE'}`);
  if (isTestMode) {
    console.log('⚠️  Using TEST mode - no real charges');
  }
}
