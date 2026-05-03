/**
 * Late Fee Protection — payment execution layer.
 *
 * Three modes, controlled by AUTOPAY_EXECUTION_MODE env:
 *   - 'disabled' (default): executor is evaluation-only; no charges, no DB
 *     writes to paid_at. Matches the original scaffolding behavior.
 *   - 'simulate': end-to-end flow with FAKE Stripe + FAKE city portal.
 *     Writes real DB rows so we can prove the executor → user-email →
 *     audit-log chain works without moving real money.
 *   - 'live': REAL Stripe charge + REAL city portal payment. NOT YET
 *     IMPLEMENTED — throws on call. Next session will copy the off_session
 *     PaymentIntent pattern from pages/api/renewals/charge.ts and stand
 *     up a city portal payment integration.
 */

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
      stripePaymentIntentId: string;
      cityPaymentReference: string;
      amountCharged: number;
    }
  | {
      success: false;
      mode: AutopayExecutionMode;
      error: string;
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
    stripePaymentIntentId: `pi_simulated_${tail}`,
    cityPaymentReference: `SIM-CITY-${tail}`,
    amountCharged: params.finalAmount,
  };
}
