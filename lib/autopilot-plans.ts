export const AUTOPILOT_PLANS = {
  FOUNDING_ANNUAL_49: {
    code: 'FOUNDING_ANNUAL_49',
    name: 'Founding Member (Annual)',
    priceCents: 4900,
    gracePeriodDays: 7,
    priceLock: true,
    priceLockCents: 4900,
  },
  STANDARD_ANNUAL_59: {
    code: 'STANDARD_ANNUAL_59',
    name: 'Standard (Annual)',
    priceCents: 5900,
    gracePeriodDays: 7,
    priceLock: false,
    priceLockCents: null as number | null,
  },
  STANDARD_ANNUAL_79: {
    code: 'STANDARD_ANNUAL_79',
    name: 'Standard Plus (Annual)',
    priceCents: 7900,
    gracePeriodDays: 7,
    priceLock: false,
    priceLockCents: null as number | null,
  },
} as const;

export const ACTIVE_AUTOPILOT_PLAN = AUTOPILOT_PLANS.FOUNDING_ANNUAL_49;

export const AUTOPILOT_PRICE_ID =
  process.env.STRIPE_FOUNDING_ANNUAL_49_PRICE_ID ||
  process.env.STRIPE_AUTOPILOT_PRICE_ID ||
  'price_founding_annual_49';
