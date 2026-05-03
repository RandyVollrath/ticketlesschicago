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
    .select('id, contest_letter_id, ticket_id, user_id, ticket_number, amount_cents, stripe_payment_intent_id, status, created_at')
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

      // Operator alert
      await sendAutopayOperatorAlert({
        subject: `[Autopay live] Auto-refunded $${(job.amount_cents / 100).toFixed(2)} — city payment timed out`,
        text: `Letter: ${job.contest_letter_id}\nTicket: ${job.ticket_number}\nUser: ${job.user_id}\nStripe PI: ${job.stripe_payment_intent_id}\nRefund: ${refund.id}\nReason: city worker did not complete within ${timeoutHours}h`,
        html: `<p><strong>Auto-refund issued</strong></p><p>Letter: <code>${job.contest_letter_id}</code></p><p>Ticket: ${job.ticket_number}</p><p>Stripe PI: <code>${job.stripe_payment_intent_id}</code></p><p>Refund: <code>${refund.id}</code></p><p>Reason: city payment worker did not complete within ${timeoutHours}h.</p>`,
      }).catch((e) => console.error(`refund alert failed: ${e.message}`));

      results.refunded++;
    } catch (err: any) {
      results.refundFailed++;
      results.errors.push(`${job.id}: ${err.message || String(err)}`);
      await sendAutopayOperatorAlert({
        subject: `[Autopay live] Refund FAILED for ${job.contest_letter_id} — manual reconciliation`,
        text: `Stripe PI: ${job.stripe_payment_intent_id}\nError: ${err.message || String(err)}\n\nThe queue row is still in its prior status. Refund the charge manually via the Stripe dashboard.`,
        html: `<p><strong>Refund failed</strong></p><p>Letter: <code>${job.contest_letter_id}</code></p><p>Stripe PI: <code>${job.stripe_payment_intent_id}</code></p><p>Error: ${err.message || String(err)}</p>`,
      }).catch(() => undefined);
    }
  }

  return res.status(200).json({ success: true, ...results });
}
