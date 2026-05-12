// Stripe charge for an auto-renewal that has a granted consent record.
//
// Off-session merchant-initiated transaction. Pulls the user's stored
// default payment method and charges total_amount_cents from the consent.
// mandate_data links the consent's IP/UA/granted_at so disputes can be
// defended on the basis of explicit per-renewal user authorization.
//
// Idempotency key is keyed on the consent record id, so a retry of the
// same renewal never double-charges.

import type Stripe from 'stripe';
import { stripe, resolveDefaultStripePaymentMethod } from './stripe-default-payment-method';
import { supabaseAdmin } from './supabase';
import type { ConsentRecord } from './renewal-consent';

export interface RenewalChargeResult {
  success: boolean;
  paymentIntentId: string | null;
  amountChargedCents: number | null;
  error?: string;
  declineCode?: string | null;
}

export interface RenewalChargeInput {
  consent: ConsentRecord;
  userEmail: string;
  description?: string;
}

const TYPE_DESCRIPTIONS: Record<string, string> = {
  city_sticker: 'Chicago city vehicle sticker renewal',
  license_plate: 'Illinois license plate sticker renewal',
};

export async function chargeRenewalConsent(input: RenewalChargeInput): Promise<RenewalChargeResult> {
  const { consent } = input;

  if (consent.status !== 'granted') {
    return { success: false, paymentIntentId: null, amountChargedCents: null, error: `Consent not granted (status=${consent.status})` };
  }

  // Look up the user's Stripe customer id
  const { data: profile, error: profErr } = await supabaseAdmin
    .from('user_profiles')
    .select('stripe_customer_id, email')
    .eq('user_id', consent.user_id)
    .maybeSingle();

  if (profErr || !profile) {
    return { success: false, paymentIntentId: null, amountChargedCents: null, error: 'user_profiles lookup failed' };
  }
  const customerId = (profile as any).stripe_customer_id as string | null;
  if (!customerId) {
    return { success: false, paymentIntentId: null, amountChargedCents: null, error: 'No Stripe customer on file' };
  }

  let paymentMethodId: string | null;
  try {
    const pm = await resolveDefaultStripePaymentMethod(customerId);
    paymentMethodId = pm.paymentMethodId;
  } catch (e: any) {
    return { success: false, paymentIntentId: null, amountChargedCents: null, error: `Default PM lookup failed: ${e?.message || e}` };
  }
  if (!paymentMethodId) {
    return { success: false, paymentIntentId: null, amountChargedCents: null, error: 'No default payment method on customer' };
  }

  const idempotencyKey = `renewal_${consent.id}`;

  const mandateData =
    consent.granted_at
      ? {
          customer_acceptance: {
            type: 'online' as const,
            accepted_at: Math.floor(new Date(consent.granted_at).getTime() / 1000),
            online: {
              ip_address: consent.granted_ip || '0.0.0.0',
              user_agent: (consent as any).granted_user_agent || 'unknown',
            },
          },
        }
      : undefined;

  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: consent.total_amount_cents,
        currency: 'usd',
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        description: input.description || TYPE_DESCRIPTIONS[consent.renewal_type] || 'Autopilot renewal',
        receipt_email: input.userEmail || undefined,
        ...(mandateData ? { mandate_data: mandateData } : {}),
        metadata: {
          renewal_consent_id: consent.id,
          renewal_type: consent.renewal_type,
          user_id: consent.user_id,
          license_plate: consent.license_plate || '',
          gov_amount_cents: String(consent.gov_amount_cents),
          service_fee_cents: String(consent.service_fee_cents),
        },
      },
      { idempotencyKey },
    );

    if (pi.status === 'succeeded') {
      return {
        success: true,
        paymentIntentId: pi.id,
        amountChargedCents: pi.amount,
      };
    }
    return {
      success: false,
      paymentIntentId: pi.id,
      amountChargedCents: null,
      error: `PaymentIntent status=${pi.status}`,
    };
  } catch (err: any) {
    const sErr = err as Stripe.errors.StripeError;
    const piId = (sErr as any).payment_intent?.id || null;
    return {
      success: false,
      paymentIntentId: piId,
      amountChargedCents: null,
      error: sErr.message || String(err),
      declineCode: (sErr as any).decline_code || null,
    };
  }
}

/**
 * Refund a renewal charge after the gov-side automation failed. Best-effort —
 * if the refund itself fails we log but don't throw, so the failure handler
 * can still proceed.
 */
export async function refundRenewalCharge(paymentIntentId: string, reason: string): Promise<{ success: boolean; refundId?: string; error?: string }> {
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntentId,
        reason: 'requested_by_customer',
        metadata: { refund_reason: reason.slice(0, 200) },
      },
      { idempotencyKey: `refund_${paymentIntentId}` },
    );
    return { success: refund.status === 'succeeded' || refund.status === 'pending', refundId: refund.id };
  } catch (err: any) {
    console.error('[renewal-charge] refund failed:', err);
    return { success: false, error: err?.message || String(err) };
  }
}
