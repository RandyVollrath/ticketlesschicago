/**
 * Price audit — confirms what Stripe is ACTUALLY going to charge for each
 * subscription path. There are two checkout paths in the codebase:
 *
 *   /api/protection/checkout (used by /protection page) — reads
 *     stripeConfig.protectionAnnualPriceId / protectionMonthlyPriceId
 *     which resolve from STRIPE_PROTECTION_*_PRICE_ID env vars.
 *
 *   /api/autopilot/create-checkout (used by /start, homepage, etc.) —
 *     reads AUTOPILOT_PRICE_ID / AUTOPILOT_MONTHLY_PRICE_ID from
 *     lib/autopilot-plans.ts, which falls through STANDARD_ANNUAL_79
 *     → STANDARD_ANNUAL_99 → STRIPE_AUTOPILOT_PRICE_ID, etc.
 *
 * This endpoint takes the live env-resolved price IDs from both paths,
 * looks each one up via the Stripe API, and returns the actual unit_amount
 * the user would be charged. Lets us verify there's no drift between
 * what the marketing copy claims and what Stripe will actually bill.
 *
 * GET /api/admin/price-audit  with header: x-admin-token: <ADMIN_API_TOKEN>
 *
 * Returns: per-path { resolvedPriceId, stripeUnitAmount, interval, currency, livemode }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { safeCompare } from '../../../lib/auth-middleware';
import { stripeConfig } from '../../../lib/stripe-config';
import { AUTOPILOT_PRICE_ID, AUTOPILOT_MONTHLY_PRICE_ID } from '../../../lib/autopilot-plans';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = req.headers['x-admin-token'] as string;
  const adminToken = process.env.ADMIN_API_TOKEN;
  if (!adminToken) {
    return res.status(500).json({ error: 'ADMIN_API_TOKEN not configured' });
  }
  if (!token || !safeCompare(token, adminToken)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const stripeKey = stripeConfig.secretKey;
  if (!stripeKey) {
    return res.status(500).json({ error: 'Stripe secret key not configured' });
  }
  const stripe = new Stripe(stripeKey);

  const result: any = {
    paths: {
      checkout_canonical: {
        used_by: 'All paid signup paths (/start, /protection, homepage, /api/autopilot/create-checkout, /api/protection/checkout, /api/create-checkout)',
        annual_price_id_source_var: 'STANDARD_ANNUAL_79 → STANDARD_ANNUAL_99 → STRIPE_AUTOPILOT_PRICE_ID (fallback chain in lib/autopilot-plans.ts)',
        monthly_price_id_source_var: 'STANDARD_MONTHLY_9 → STANDARD_MONTHLY_10 → STRIPE_AUTOPILOT_MONTHLY_PRICE_ID (fallback chain)',
        annual_resolved_price_id: AUTOPILOT_PRICE_ID,
        monthly_resolved_price_id: AUTOPILOT_MONTHLY_PRICE_ID,
      },
      legacy_stripe_protection_vars: {
        note: 'These env vars used to be the source for /api/protection/checkout, but as of 2026-05-17 protection/checkout reads AUTOPILOT_PRICE_ID instead. We keep these surfaced here so any future drift between the two sources is visible.',
        annual_resolved_price_id: stripeConfig.protectionAnnualPriceId || '(not set)',
        monthly_resolved_price_id: stripeConfig.protectionMonthlyPriceId || '(not set)',
      },
    },
    stripe_amounts: {} as any,
  };

  // Pull each unique price ID and look it up in Stripe
  const uniquePriceIds = new Set<string>(
    [
      stripeConfig.protectionAnnualPriceId,
      stripeConfig.protectionMonthlyPriceId,
      AUTOPILOT_PRICE_ID,
      AUTOPILOT_MONTHLY_PRICE_ID,
    ].filter(Boolean) as string[],
  );

  for (const priceId of uniquePriceIds) {
    // Skip literal-fallback strings that aren't real Stripe price IDs
    if (!priceId.startsWith('price_')) {
      result.stripe_amounts[priceId] = { error: 'Not a real Stripe price ID — would fail at checkout time' };
      continue;
    }
    try {
      const price = await stripe.prices.retrieve(priceId);
      result.stripe_amounts[priceId] = {
        unit_amount: price.unit_amount,
        unit_amount_dollars: price.unit_amount != null ? (price.unit_amount / 100).toFixed(2) : null,
        currency: price.currency,
        recurring_interval: price.recurring?.interval,
        livemode: price.livemode,
        active: price.active,
        nickname: price.nickname,
        product: typeof price.product === 'string' ? price.product : (price.product as any)?.id,
      };
    } catch (err: any) {
      result.stripe_amounts[priceId] = {
        error: err.message,
      };
    }
  }

  // Drift summary — true means "legacy vars match canonical vars". After
  // the 2026-05-17 consolidation, only the canonical pair is actually used
  // for checkout, but agreement here means a future regression that points
  // the legacy vars at the wrong price won't bite us either.
  result.summary = {
    canonical_annual_charges_dollars: result.stripe_amounts[AUTOPILOT_PRICE_ID]?.unit_amount_dollars,
    canonical_monthly_charges_dollars: result.stripe_amounts[AUTOPILOT_MONTHLY_PRICE_ID]?.unit_amount_dollars,
    legacy_vars_agree_on_annual:
      stripeConfig.protectionAnnualPriceId &&
      AUTOPILOT_PRICE_ID &&
      stripeConfig.protectionAnnualPriceId === AUTOPILOT_PRICE_ID,
    legacy_vars_agree_on_monthly:
      stripeConfig.protectionMonthlyPriceId &&
      AUTOPILOT_MONTHLY_PRICE_ID &&
      stripeConfig.protectionMonthlyPriceId === AUTOPILOT_MONTHLY_PRICE_ID,
  };

  return res.status(200).json(result);
}
