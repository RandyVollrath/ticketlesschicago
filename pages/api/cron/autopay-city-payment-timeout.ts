/**
 * Cron: refund Stripe charges whose city payment never completed.
 *
 * If the autopilot-autopay-executor cron successfully charges a user's
 * card via Stripe but the local city_payment_queue worker never paid the
 * city portal (worker offline, portal down, retries exhausted), we don't
 * want to leave the user charged with no benefit.
 *
 * After CITY_PAYMENT_REFUND_TIMEOUT_HOURS (default 48) of being stuck in
 * 'pending' / 'in_progress' / 'manual_required', this cron:
 *   1. Refunds the Stripe charge in full
 *   2. Marks contest_letter as lifecycle_status='payment_failed'
 *   3. Marks the queue row as 'refunded'
 *   4. Emails the user "we couldn't reach the city portal — please pay manually"
 *   5. Emails operator
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { stripe } from '../../../lib/stripe-default-payment-method';
import { sendAutopayFailedEmail } from '../../../lib/autopay-user-emails';
import { sendAutopayOperatorAlert } from '../../../lib/autopay-alerts';

export const config = { maxDuration: 60 };

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DEFAULT_TIMEOUT_HOURS = 48;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const timeoutHours = Number(process.env.CITY_PAYMENT_REFUND_TIMEOUT_HOURS || DEFAULT_TIMEOUT_HOURS);
  const cutoffMs = Date.now() - timeoutHours * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const { data: stuck, error } = await supabaseAdmin
    .from('city_payment_queue')
    .select('id, contest_letter_id, ticket_id, user_id, ticket_number, plate, state, amount_cents, stripe_payment_intent_id, status, created_at')
    .in('status', ['pending', 'in_progress', 'manual_required'])
    .lte('created_at', cutoffIso);

  if (error) return res.status(500).json({ error: error.message });

  const results = {
    timeoutHours,
    found: stuck?.length || 0,
    refunded: 0,
    refundFailed: 0,
    errors: [] as string[],
  };

  for (const job of stuck || []) {
    try {
      // Refund the Stripe charge in full
      const refund = await stripe.refunds.create({
        payment_intent: job.stripe_payment_intent_id,
        reason: 'requested_by_customer',
        metadata: {
          autopay_refund: 'true',
          contest_letter_id: job.contest_letter_id,
          reason_detail: `City payment did not complete within ${timeoutHours}h`,
        },
      });

      const now = new Date().toISOString();

      // Mark queue row refunded
      await supabaseAdmin
        .from('city_payment_queue')
        .update({
          status: 'refunded',
          refunded_at: now,
          refund_reason: `Auto-refund after ${timeoutHours}h timeout. Stripe refund: ${refund.id}`,
        })
        .eq('id', job.id);

      // Mark contest letter as payment_failed (user now owes the city directly)
      await supabaseAdmin
        .from('contest_letters')
        .update({
          autopay_status: 'refunded_timeout',
          lifecycle_status: 'payment_failed',
          lifecycle_status_changed_at: now,
        })
        .eq('id', job.contest_letter_id);

      // Insert audit event
      await supabaseAdmin.from('contest_status_events').insert([{
        contest_letter_id: job.contest_letter_id,
        ticket_id: job.ticket_id,
        user_id: job.user_id,
        event_type: 'autopay_refunded_city_timeout',
        source: 'autopay_city_payment_timeout',
        normalized_status: 'payment_failed',
        raw_status: refund.id,
        details: {
          stripeRefundId: refund.id,
          stripePaymentIntentId: job.stripe_payment_intent_id,
          timeoutHours,
        },
      }]);

      // User email
      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('email, first_name')
        .eq('user_id', job.user_id)
        .maybeSingle();

      if (profile?.email) {
        await sendAutopayFailedEmail({
          to: profile.email,
          firstName: profile.first_name,
          ticketNumber: job.ticket_number,
          finalAmount: job.amount_cents / 100,
          errorMessage: `We charged your card but could not reach the City of Chicago payment portal in time. Your card has been refunded — please pay your ticket directly with the city before the deadline.`,
        }).catch((e) => console.error(`refund-email failed: ${e.message}`));
      }

      // LOUD operator alert: even though the auto-refund worked and the user
      // is financially whole, the underlying city payment FAILED. Per user
      // request, any payment failure (especially "the website failed") must
      // generate a screaming alert so the operator can investigate the
      // root cause before more autopay jobs hit the same issue.
      await sendAutopayOperatorAlert({
        severity: 'emergency',
        subject: `🚨 CITY PAYMENT FAILED — auto-refunded $${(job.amount_cents / 100).toFixed(2)} to ${job.ticket_number}`,
        text: [
          `🚨 CITY OF CHICAGO PAYMENT FAILED — user was auto-refunded.`,
          ``,
          `The city portal did not accept payment within ${timeoutHours}h. The Stripe charge has been refunded to the user automatically, so they are NOT out money. BUT the underlying problem (city website down, portal flow changed, queue worker stuck, etc.) is unresolved and will affect every subsequent autopay job until you investigate.`,
          ``,
          `Letter: ${job.contest_letter_id}`,
          `Ticket: ${job.ticket_number} (${job.plate}/${job.state || 'IL'})`,
          `User: ${job.user_id}`,
          `Amount refunded: $${(job.amount_cents / 100).toFixed(2)}`,
          `Stripe PI (refunded): ${job.stripe_payment_intent_id}`,
          `Stripe refund: ${refund.id}`,
          ``,
          `Action items:`,
          `  1. Check the city payment portal manually — is it down? Has its flow changed?`,
          `  2. Check 'journalctl --user -u city-payment-queue.service' for the Playwright errors that caused the failures.`,
          `  3. Check the city_payment_queue table for other jobs stuck pending.`,
          `  4. Notify the user (${job.user_id}) that they should pay the ticket manually before the late-fee deadline.`,
        ].join('\n'),
        html: `<p><strong>🚨 City of Chicago payment FAILED — user auto-refunded.</strong></p>
        <p>The city portal did not accept payment within ${timeoutHours}h. The Stripe charge has been refunded to the user, so they are NOT out money. <strong>BUT the underlying problem is unresolved</strong> and will affect every subsequent autopay job until you investigate.</p>
        <ul>
          <li>Letter: <code>${job.contest_letter_id}</code></li>
          <li>Ticket: ${job.ticket_number} (${job.plate}/${job.state || 'IL'})</li>
          <li>User: <code>${job.user_id}</code></li>
          <li>Amount refunded: <strong>$${(job.amount_cents / 100).toFixed(2)}</strong></li>
          <li>Stripe PI (refunded): <code>${job.stripe_payment_intent_id}</code></li>
          <li>Stripe refund: <code>${refund.id}</code></li>
        </ul>
        <p><strong>Action items:</strong></p>
        <ol>
          <li>Check the city payment portal manually — is it down? Has its flow changed?</li>
          <li>Check <code>journalctl --user -u city-payment-queue.service</code> for the Playwright errors that caused the failures.</li>
          <li>Check the <code>city_payment_queue</code> table for other jobs stuck pending.</li>
          <li>Notify the user that they should pay the ticket manually before the late-fee deadline.</li>
        </ol>`,
      }).catch((e) => console.error(`refund alert failed: ${e.message}`));

      results.refunded++;
    } catch (err: any) {
      results.refundFailed++;
      results.errors.push(`${job.id}: ${err.message || String(err)}`);
      await sendAutopayOperatorAlert({
        severity: 'emergency',
        subject: `Refund FAILED for ${job.contest_letter_id} — manual reconciliation`,
        text: `Stripe PI: ${job.stripe_payment_intent_id}\nError: ${err.message || String(err)}\n\nThe queue row is still in its prior status. Refund the charge manually via the Stripe dashboard.`,
        html: `<p><strong>Refund failed</strong></p><p>Letter: <code>${job.contest_letter_id}</code></p><p>Stripe PI: <code>${job.stripe_payment_intent_id}</code></p><p>Error: ${err.message || String(err)}</p>`,
      }).catch(() => undefined);
    }
  }

  return res.status(200).json({ success: true, ...results });
}
