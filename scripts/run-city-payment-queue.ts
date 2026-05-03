/**
 * City Payment Queue Worker
 *
 * Drains rows from city_payment_queue (status='pending') and pays the
 * City of Chicago payment portal on behalf of users whose Stripe charge
 * has already cleared (per the autopilot-autopay-executor cron).
 *
 * RUN OUTSIDE VERCEL — same pattern as scripts/autopilot-check-portal.ts.
 * Recommended: systemd timer every 15 minutes on a local machine / VPS
 * with Playwright + Chromium installed.
 *
 *   systemctl --user start autopilot-city-payment-queue.timer
 *
 * ─── STATUS: PARTIALLY IMPLEMENTED ────────────────────────────────────
 *
 * The queue plumbing (claim job → mark in_progress → success/failure
 * flow → contest_letter update → user email) IS implemented and tested.
 *
 * The actual Playwright steps that pay the portal (navigate to ticket,
 * click "Pay this ticket", fill card form, confirm) are NOT IMPLEMENTED.
 * The function `payViaCityPortal()` below is a stub that throws. To go
 * live with city payment automation, you (or an operator) must:
 *
 *   1. Run `scripts/probe-city-portal-payment.ts` against a real ticket
 *      to capture the form selectors and network endpoints.
 *   2. Replace the stub with real Playwright code based on what the
 *      probe found.
 *   3. Test once with a real $X ticket of your own — you watching.
 *   4. Enable the systemd timer.
 *
 * Until the stub is replaced, every job stays in `pending` forever and
 * the timeout-refund reconciliation cron (autopay-city-payment-timeout)
 * will refund the Stripe charge after CITY_PAYMENT_REFUND_TIMEOUT_HOURS.
 * That keeps users from being charged without their ticket being paid.
 */

import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { sendAutopayPaidEmail, sendAutopayFailedEmail } from '../lib/autopay-user-emails';
import { sendAutopayOperatorAlert } from '../lib/autopay-alerts';

const MAX_ATTEMPTS = 3;
const WORKER_ID = `city-payment-${process.pid}-${randomUUID().slice(0, 8)}`;

interface QueueRow {
  id: string;
  contest_letter_id: string;
  ticket_id: string;
  user_id: string;
  ticket_number: string;
  plate: string;
  state: string;
  amount_cents: number;
  stripe_payment_intent_id: string;
  attempts: number;
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  console.log(`[city-payment-worker:${WORKER_ID}] starting`);

  // Claim a single pending job atomically. Use UPDATE...WHERE status='pending'
  // RETURNING * pattern via PostgREST: select first, then update with optimistic
  // worker_id check.
  const { data: candidates, error: pickErr } = await supabase
    .from('city_payment_queue')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (pickErr) {
    console.error('Failed to query queue:', pickErr.message);
    process.exit(1);
  }

  if (!candidates || candidates.length === 0) {
    console.log(`[city-payment-worker:${WORKER_ID}] no pending jobs`);
    return;
  }

  for (const job of candidates as QueueRow[]) {
    // Optimistic claim
    const { data: claimed, error: claimErr } = await supabase
      .from('city_payment_queue')
      .update({
        status: 'in_progress',
        worker_id: WORKER_ID,
        worker_claimed_at: new Date().toISOString(),
        attempts: job.attempts + 1,
        last_attempt_at: new Date().toISOString(),
      })
      .eq('id', job.id)
      .eq('status', 'pending') // race guard: another worker may have claimed
      .select()
      .maybeSingle();

    if (claimErr || !claimed) {
      console.log(`[city-payment-worker:${WORKER_ID}] could not claim ${job.id} (probably claimed by another worker)`);
      continue;
    }

    console.log(`[city-payment-worker:${WORKER_ID}] processing ${job.id} ticket=${job.ticket_number} plate=${job.plate}/${job.state} amount=$${(job.amount_cents / 100).toFixed(2)}`);

    try {
      const result = await payViaCityPortal({
        ticketNumber: job.ticket_number,
        plate: job.plate,
        state: job.state,
        amountCents: job.amount_cents,
      });

      await markPaid(supabase, job, result);
      console.log(`[city-payment-worker:${WORKER_ID}] ✅ paid ${job.id} ref=${result.cityReference}`);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`[city-payment-worker:${WORKER_ID}] ❌ failed ${job.id}: ${message}`);
      await markFailed(supabase, job, message);
    }
  }

  console.log(`[city-payment-worker:${WORKER_ID}] done`);
}

/**
 * STUB. Replace with real Playwright automation against
 * https://webapps1.chicago.gov/payments-web/
 *
 * Probe first: scripts/probe-city-portal-payment.ts
 */
async function payViaCityPortal(params: {
  ticketNumber: string;
  plate: string;
  state: string;
  amountCents: number;
}): Promise<{ cityReference: string; rawResponse: any }> {
  throw new Error(
    'NOT_YET_IMPLEMENTED: city portal payment automation has not been built. ' +
    'Run scripts/probe-city-portal-payment.ts first to capture the payment ' +
    `form selectors, then implement payViaCityPortal() in this file. ` +
    `Job context: ticket=${params.ticketNumber} plate=${params.plate}/${params.state} amount=$${(params.amountCents / 100).toFixed(2)}`,
  );
}

async function markPaid(
  supabase: SupabaseClient<any>,
  job: QueueRow,
  result: { cityReference: string; rawResponse: any },
) {
  const now = new Date().toISOString();

  // Update queue row
  await supabase
    .from('city_payment_queue')
    .update({
      status: 'paid',
      city_payment_reference: result.cityReference,
      city_response_payload: result.rawResponse,
      paid_at: now,
      worker_id: null,
      last_error: null,
    })
    .eq('id', job.id);

  // Update contest letter to fully paid
  await supabase
    .from('contest_letters')
    .update({
      paid_at: now,
      payment_reference: result.cityReference,
      lifecycle_status: 'paid',
      lifecycle_status_changed_at: now,
      autopay_status: 'paid',
    })
    .eq('id', job.contest_letter_id);

  // Insert audit event
  await supabase
    .from('contest_status_events')
    .insert([{
      contest_letter_id: job.contest_letter_id,
      ticket_id: job.ticket_id,
      user_id: job.user_id,
      event_type: 'autopay_city_paid',
      source: 'city_payment_worker',
      normalized_status: 'paid',
      raw_status: result.cityReference,
      details: {
        cityPaymentReference: result.cityReference,
        stripePaymentIntentId: job.stripe_payment_intent_id,
        amountCents: job.amount_cents,
      },
    }]);

  // Send the user "we paid your ticket" email
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, first_name')
    .eq('user_id', job.user_id)
    .maybeSingle();

  if (profile?.email) {
    await sendAutopayPaidEmail({
      to: profile.email,
      firstName: profile.first_name,
      ticketNumber: job.ticket_number,
      amountCharged: job.amount_cents / 100,
      cityPaymentReference: result.cityReference,
      isSimulated: false,
    }).catch((e) => console.error(`paid-email failed: ${e.message}`));
  }
}

async function markFailed(
  supabase: SupabaseClient<any>,
  job: QueueRow,
  errorMessage: string,
) {
  const reachedMax = job.attempts + 1 >= MAX_ATTEMPTS;

  await supabase
    .from('city_payment_queue')
    .update({
      status: reachedMax ? 'manual_required' : 'pending',
      last_error: errorMessage,
      worker_id: null,
    })
    .eq('id', job.id);

  // Insert audit event
  await supabase
    .from('contest_status_events')
    .insert([{
      contest_letter_id: job.contest_letter_id,
      ticket_id: job.ticket_id,
      user_id: job.user_id,
      event_type: 'autopay_city_attempt_failed',
      source: 'city_payment_worker',
      normalized_status: 'lost',
      raw_status: errorMessage,
      details: {
        attempts: job.attempts + 1,
        reachedMax,
        stripePaymentIntentId: job.stripe_payment_intent_id,
      },
    }]);

  if (reachedMax) {
    // Don't auto-refund here — the timeout-refund cron handles refunds
    // after CITY_PAYMENT_REFUND_TIMEOUT_HOURS so we don't refund a
    // payment that the local script COULD have completed manually.
    await sendAutopayOperatorAlert({
      subject: `[Autopay live] City payment failed ${MAX_ATTEMPTS}x for ${job.contest_letter_id} — manual review`,
      text: [
        `Contest letter: ${job.contest_letter_id}`,
        `Ticket: ${job.ticket_number} (${job.plate}/${job.state})`,
        `Amount: $${(job.amount_cents / 100).toFixed(2)}`,
        `Stripe PI: ${job.stripe_payment_intent_id}`,
        `Last error: ${errorMessage}`,
        ``,
        `Decide: pay manually via the city portal, or refund via the Stripe dashboard. The timeout-refund cron will auto-refund after CITY_PAYMENT_REFUND_TIMEOUT_HOURS if you do nothing.`,
      ].join('\n'),
      html: `<p><strong>City payment exhausted retries</strong></p><p>Letter: <code>${job.contest_letter_id}</code></p><p>Ticket: ${job.ticket_number} (${job.plate}/${job.state})</p><p>Amount: $${(job.amount_cents / 100).toFixed(2)}</p><p>Stripe PI: <code>${job.stripe_payment_intent_id}</code></p><p>Last error: ${errorMessage}</p>`,
    }).catch((e) => console.error(`failed alert: ${e.message}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[city-payment-worker:${WORKER_ID}] uncaught error:`, err);
    process.exit(1);
  });
