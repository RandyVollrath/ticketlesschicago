/**
 * Late Fee Protection — payment execution layer.
 *
 * Three modes, controlled by AUTOPAY_EXECUTION_MODE env:
 *   - 'disabled' (default): executor is evaluation-only; no charges, no DB
 *     writes to paid_at. Matches the original scaffolding behavior.
 *   - 'simulate': end-to-end flow with FAKE Stripe + FAKE city portal.
 *     Writes real DB rows so we can prove the executor → user-email →
 *     audit-log chain works without moving real money.
 *   - 'live': REAL Stripe charge (off_session) + city payment QUEUED for
 *     a separate local script. The Stripe leg runs in this process; the
 *     city portal leg requires Playwright + Chromium and so cannot run
 *     in a Vercel function — it lives in scripts/run-city-payment-queue.ts
 *     and gets executed by a systemd timer on your local machine / VPS,
 *     same pattern as scripts/autopilot-check-portal.ts.
 *
 * The letter does NOT transition to lifecycle_status='paid' until the
 * city portal script confirms the payment was accepted. If the city leg
 * doesn't complete within CITY_PAYMENT_REFUND_TIMEOUT_HOURS (default 48),
 * a separate reconciliation job refunds the Stripe charge and emails the
 * user "we couldn't reach the city — please pay manually."
 */

import Stripe from 'stripe';
import { stripe } from './stripe-default-payment-method';

export type AutopayExecutionMode = 'disabled' | 'simulate' | 'live';

export function getAutopayExecutionMode(): AutopayExecutionMode {
  const raw = (process.env.AUTOPAY_EXECUTION_MODE || '').trim().toLowerCase();
  if (raw === 'simulate' || raw === 'live') return raw;
  return 'disabled';
}

export type ExecutionResult =
  | {
      success: true;
      mode: 'simulate';
      // Simulate mode: city payment is also fake, so the letter goes
      // straight to lifecycle='paid' in the executor.
      cityLegStatus: 'simulated';
      stripePaymentIntentId: string;
      cityPaymentReference: string;
      amountCharged: number;
    }
  | {
      success: true;
      mode: 'live';
      // Live mode: Stripe succeeded but the city portal payment must be
      // performed by the out-of-process script. Letter stays in
      // lifecycle='lost', autopay_status='charged_pending_city' until
      // the city script picks it up.
      cityLegStatus: 'queued';
      stripePaymentIntentId: string;
      cityPaymentReference: null;
      amountCharged: number;
    }
  | {
      success: false;
      mode: AutopayExecutionMode;
      error: string;
      // For live mode failures we may need to know whether Stripe was
      // ever charged (so the reconciliation job knows to refund). null
      // means we never made it to Stripe.
      stripePaymentIntentId?: string | null;
    };

/**
 * Simulated autopay execution. Returns fake-but-recognizable IDs and never
 * touches Stripe or the City portal. Use only when AUTOPAY_EXECUTION_MODE
 * is 'simulate'.
 */
export function executeSimulatedAutopay(params: {
  contestLetterId: string;
  finalAmount: number | null;
  paymentMethodId: string | null;
}): ExecutionResult {
  if (params.finalAmount == null || params.finalAmount <= 0) {
    return {
      success: false,
      mode: 'simulate',
      error: `Cannot execute autopay: final_amount is ${params.finalAmount}`,
    };
  }
  if (!params.paymentMethodId) {
    return {
      success: false,
      mode: 'simulate',
      error: 'Cannot execute autopay: no payment method on file',
    };
  }

  const tail = params.contestLetterId.replace(/-/g, '').slice(0, 12);
  return {
    success: true,
    mode: 'simulate',
    cityLegStatus: 'simulated',
    stripePaymentIntentId: `pi_simulated_${tail}`,
    cityPaymentReference: `SIM-CITY-${tail}`,
    amountCharged: params.finalAmount,
  };
}

/**
 * Live autopay execution — Stripe leg only.
 *
 * Charges the user's stored card via off_session PaymentIntent, with the
 * idempotency-key pattern proven in pages/api/renewals/charge.ts. On
 * success, the caller must (a) update contest_letters with the
 * paymentIntentId and autopay_status='charged_pending_city', AND (b)
 * insert a row into city_payment_queue for the local Playwright script
 * to pick up.
 *
 * Critical: this function returns success=true the moment Stripe accepts
 * the charge. The contest letter is NOT yet considered paid. Only the
 * city portal script can transition it to lifecycle_status='paid'.
 */
export async function executeLiveStripeCharge(params: {
  contestLetterId: string;
  ticketId: string;
  userId: string;
  finalAmount: number | null;
  paymentMethodId: string | null;
  stripeCustomerId: string | null;
  userEmail: string | null;
}): Promise<ExecutionResult> {
  if (params.finalAmount == null || params.finalAmount <= 0) {
    return {
      success: false,
      mode: 'live',
      error: `Cannot execute autopay: final_amount is ${params.finalAmount}`,
      stripePaymentIntentId: null,
    };
  }
  if (!params.paymentMethodId) {
    return {
      success: false,
      mode: 'live',
      error: 'Cannot execute autopay: no payment method on file',
      stripePaymentIntentId: null,
    };
  }
  if (!params.stripeCustomerId) {
    return {
      success: false,
      mode: 'live',
      error: 'Cannot execute autopay: no Stripe customer id',
      stripePaymentIntentId: null,
    };
  }

  // The amount the user actually pays — the city fine. We do NOT add a
  // service fee for autopay (decision can be revisited; for now the user
  // promise is "we pay the exact fine").
  const amountCents = Math.round(params.finalAmount * 100);

  try {
    // Idempotency key ties the Stripe call to the contest letter. If the
    // executor runs twice in close succession (despite the 5-min cooldown
    // upstream), Stripe will return the same PaymentIntent rather than
    // double-charging.
    const idempotencyKey = `autopay_${params.contestLetterId}`;

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: 'usd',
        customer: params.stripeCustomerId,
        payment_method: params.paymentMethodId,
        off_session: true,
        confirm: true,
        description: `Autopilot Late Fee Protection — contest letter ${params.contestLetterId}`,
        receipt_email: params.userEmail || undefined,
        metadata: {
          autopay: 'true',
          contest_letter_id: params.contestLetterId,
          ticket_id: params.ticketId,
          user_id: params.userId,
        },
      },
      { idempotencyKey },
    );

    if (paymentIntent.status === 'succeeded') {
      return {
        success: true,
        mode: 'live',
        cityLegStatus: 'queued',
        stripePaymentIntentId: paymentIntent.id,
        cityPaymentReference: null,
        amountCharged: params.finalAmount,
      };
    }

    // requires_action / requires_payment_method / etc — for off_session
    // these all mean the card isn't usable. Treat as failure.
    return {
      success: false,
      mode: 'live',
      error: `PaymentIntent status=${paymentIntent.status}`,
      stripePaymentIntentId: paymentIntent.id,
    };
  } catch (err: any) {
    // Stripe-specific errors: card_declined, expired_card, etc. Capture
    // the paymentIntent id if Stripe gave one back (it does for declines).
    const stripeErr = err as Stripe.errors.StripeError;
    const piId = (stripeErr as any).payment_intent?.id || null;
    return {
      success: false,
      mode: 'live',
      error: stripeErr.message || String(err),
      stripePaymentIntentId: piId,
    };
  }
}
