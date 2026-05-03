/**
 * City payment queue helpers — used by the autopay executor (to enqueue)
 * and by scripts/run-city-payment-queue.ts (to drain).
 *
 * The actual portal automation runs OUTSIDE Vercel (Playwright + Chromium),
 * so the executor and the worker are decoupled via this queue table.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface CityPaymentJob {
  contestLetterId: string;
  ticketId: string;
  userId: string;
  ticketNumber: string;
  plate: string;
  state: string;
  amountCents: number;
  stripePaymentIntentId: string;
}

/**
 * Insert a job into city_payment_queue. Idempotent on stripe_payment_intent_id
 * via the unique constraint — if the same Stripe charge gets queued twice
 * (e.g. cron retry while a previous run was mid-flight) the second insert
 * is a no-op.
 */
export async function enqueueCityPayment(
  supabase: SupabaseClient<any>,
  job: CityPaymentJob,
): Promise<{ enqueued: boolean; error?: string }> {
  const { error } = await (supabase.from('city_payment_queue') as any).insert([{
    contest_letter_id: job.contestLetterId,
    ticket_id: job.ticketId,
    user_id: job.userId,
    ticket_number: job.ticketNumber,
    plate: job.plate,
    state: job.state,
    amount_cents: job.amountCents,
    stripe_payment_intent_id: job.stripePaymentIntentId,
    status: 'pending',
  }]);

  if (error) {
    // Unique-constraint violation on stripe_payment_intent_id is the
    // idempotent skip case — not an error.
    if ((error as any).code === '23505') {
      return { enqueued: false };
    }
    return { enqueued: false, error: error.message };
  }
  return { enqueued: true };
}
