import type Stripe from 'stripe';

// Stripe coupon IDs are user/auto-generated strings. Be strict about what we
// accept from the browser — anything unusual gets rejected before it can hit
// Stripe and bubble up a confusing 400 mid-checkout.
const COUPON_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function sanitizeRewardfulCouponId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return COUPON_ID_PATTERN.test(trimmed) ? trimmed : null;
}

// Confirm the coupon Rewardful gave us actually exists in Stripe and is
// redeemable. Rewardful's docs warn that Stripe Checkout throws on unknown
// coupon IDs, so we pre-validate and fall back to allow_promotion_codes when
// the lookup fails for any reason.
export async function resolveRewardfulCoupon(
  stripe: Stripe,
  raw: unknown,
): Promise<string | null> {
  const id = sanitizeRewardfulCouponId(raw);
  if (!id) return null;
  try {
    const coupon = await stripe.coupons.retrieve(id);
    return coupon?.valid ? coupon.id : null;
  } catch (err: any) {
    console.warn('Rewardful coupon not found in Stripe:', id, err?.message);
    return null;
  }
}
