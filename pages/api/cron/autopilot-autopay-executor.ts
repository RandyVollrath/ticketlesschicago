import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendAutopayOperatorAlert } from '../../../lib/autopay-alerts';
import { getAutopayBetaConfig, isAutopayBetaAllowed } from '../../../lib/autopay-beta';
import { evaluateAutopayEligibility, recordContestStatusEvent } from '../../../lib/contest-lifecycle';
import { resolveDefaultStripePaymentMethod } from '../../../lib/stripe-default-payment-method';
import { executeLiveStripeCharge, executeSimulatedAutopay, getAutopayExecutionMode } from '../../../lib/autopay-execute';
import { sendAutopayFailedEmail, sendAutopayPaidEmail } from '../../../lib/autopay-user-emails';
import { enqueueCityPayment } from '../../../lib/city-payment-queue';

export const config = { maxDuration: 60 };

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// Cooldown: if an attempt was made within this window, don't try again.
// Protects against the cron firing twice in close succession (or a half-
// completed prior run leaving the row in a transitional state).
const ATTEMPT_COOLDOWN_MS = 5 * 60 * 1000;

type PayableLetter = {
  id: string;
  ticket_id: string;
  user_id: string;
  lifecycle_status: string | null;
  final_amount: number | null;
  autopay_opt_in: boolean | null;
  autopay_mode: string | null;
  autopay_cap_amount: number | null;
  autopay_payment_method_id: string | null;
  autopay_status: string | null;
  autopay_attempted_at: string | null;
  paid_at: string | null;
};

type Profile = {
  stripe_customer_id: string | null;
  email: string | null;
  first_name: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const executionMode = getAutopayExecutionMode();
  const betaConfig = getAutopayBetaConfig();

  const results = {
    mode: executionMode,
    checked: 0,
    eligible: 0,
    blocked: 0,
    notEnabled: 0,
    betaBlocked: 0,
    readyButNotExecuted: 0,
    executedSimulated: 0,
    executionFailed: 0,
    cooldownSkipped: 0,
    errors: [] as string[],
  };

  const { data, error } = await (supabaseAdmin.from('contest_letters') as any)
    .select(`
      id,
      ticket_id,
      user_id,
      lifecycle_status,
      final_amount,
      autopay_opt_in,
      autopay_mode,
      autopay_cap_amount,
      autopay_payment_method_id,
      autopay_status,
      autopay_attempted_at,
      paid_at
    `)
    .in('lifecycle_status', ['lost', 'reduced'])
    .is('paid_at', null)
    .order('updated_at', { ascending: true })
    .limit(100);

  if (error) return res.status(500).json({ error: error.message });

  for (const letter of (data || []) as PayableLetter[]) {
    results.checked++;
    try {
      // Always fetch the profile up front — we may need email + first_name
      // for the user-facing notification, not just stripe_customer_id for
      // payment method resolution.
      const { data: profileData } = await supabaseAdmin
        .from('user_profiles')
        .select('stripe_customer_id, email, first_name')
        .eq('user_id', letter.user_id)
        .maybeSingle();
      const profile: Profile = profileData || { stripe_customer_id: null, email: null, first_name: null };

      let resolvedPaymentMethodId = letter.autopay_payment_method_id;
      let resolvedSource: string = resolvedPaymentMethodId ? 'stored_on_letter' : 'none';

      if (!resolvedPaymentMethodId && profile.stripe_customer_id) {
        try {
          const resolved = await resolveDefaultStripePaymentMethod(profile.stripe_customer_id);
          resolvedPaymentMethodId = resolved.paymentMethodId;
          resolvedSource = resolved.source;
        } catch (err: any) {
          resolvedSource = `error:${err.message}`;
        }
      }

      const finalEligibility = evaluateAutopayEligibility({
        lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
        autopayOptIn: letter.autopay_opt_in,
        autopayMode: letter.autopay_mode,
        autopayCapAmount: letter.autopay_cap_amount,
        paymentMethodId: resolvedPaymentMethodId,
        finalAmount: letter.final_amount,
      });
      const betaAllowance = isAutopayBetaAllowed({
        userId: letter.user_id,
        userEmail: profile.email || null,
        contestLetterId: letter.id,
        ticketId: letter.ticket_id,
      });
      const effectiveStatus =
        finalEligibility.status === 'eligible' && !betaAllowance.allowed
          ? 'blocked'
          : finalEligibility.status;
      const effectiveReason =
        finalEligibility.status === 'eligible' && !betaAllowance.allowed
          ? betaAllowance.reason
          : finalEligibility.reason;

      const willExecute =
        (executionMode === 'simulate' || executionMode === 'live') &&
        finalEligibility.status === 'eligible' &&
        betaAllowance.allowed;

      // Cooldown guard: skip if we already tried recently. Only matters when
      // we're about to execute — pure evaluations are safe to repeat.
      if (willExecute && letter.autopay_attempted_at) {
        const last = new Date(letter.autopay_attempted_at).getTime();
        if (Number.isFinite(last) && Date.now() - last < ATTEMPT_COOLDOWN_MS) {
          results.cooldownSkipped++;
          continue;
        }
      }

      // Skip the no-op evaluation write when nothing has changed and we're
      // not about to execute. Without this the cron would write a duplicate
      // `autopay_evaluated` event into contest_status_events on every run.
      const statusUnchanged = letter.autopay_status === effectiveStatus;
      const pmUnchanged = (letter.autopay_payment_method_id || null) === (resolvedPaymentMethodId || null);
      if (!willExecute && statusUnchanged && pmUnchanged) {
        if (finalEligibility.status === 'eligible' && betaAllowance.allowed) {
          results.eligible++;
          if (executionMode === 'disabled') results.readyButNotExecuted++;
        } else if (effectiveStatus === 'blocked') {
          results.blocked++;
        } else {
          results.notEnabled++;
        }
        continue;
      }

      const evaluationPatch: Record<string, any> = {
        autopay_payment_method_id: resolvedPaymentMethodId,
        autopay_status: effectiveStatus,
        autopay_result_payload: {
          reason: effectiveReason,
          evaluatedAt: new Date().toISOString(),
          executor: 'autopilot-autopay-executor',
          executionMode,
          resolvedPaymentMethodSource: resolvedSource,
          resolvedPaymentMethodId: resolvedPaymentMethodId || null,
          betaAllowed: betaAllowance.allowed,
          betaReason: betaAllowance.reason,
          betaConfig: {
            singleExecutionContestLetterId: betaConfig.singleExecutionContestLetterId,
            allowlistedUserIdsCount: betaConfig.allowlistedUserIds.length,
            allowlistedEmailsCount: betaConfig.allowlistedEmails.length,
            allowlistedContestLetterIdsCount: betaConfig.allowlistedContestLetterIds.length,
            allowlistedTicketIdsCount: betaConfig.allowlistedTicketIds.length,
          },
        },
      };

      const { error: updateErr } = await (supabaseAdmin.from('contest_letters') as any)
        .update(evaluationPatch)
        .eq('id', letter.id);
      if (updateErr) throw new Error(updateErr.message);

      await recordContestStatusEvent(supabaseAdmin as any, {
        contestLetterId: letter.id,
        ticketId: letter.ticket_id,
        userId: letter.user_id,
        eventType: 'autopay_evaluated',
        source: 'autopay_executor',
        normalizedStatus: letter.lifecycle_status,
        rawStatus: effectiveStatus,
        details: {
          finalAmount: letter.final_amount,
          autopayMode: letter.autopay_mode,
          eligibility: finalEligibility,
          betaAllowance,
          executionMode,
          resolvedPaymentMethodSource: resolvedSource,
        },
      });

      if (finalEligibility.status === 'eligible' && !betaAllowance.allowed) {
        results.betaBlocked++;
      }

      if (!willExecute) {
        if (finalEligibility.status === 'eligible' && betaAllowance.allowed) {
          results.eligible++;
          if (executionMode === 'disabled') results.readyButNotExecuted++;
        } else if (effectiveStatus === 'blocked') {
          results.blocked++;
        } else {
          results.notEnabled++;
        }
        continue;
      }

      // ─── EXECUTION PATH (simulate or live) ───
      results.eligible++;

      // Stamp the attempt timestamp BEFORE running the execution so the
      // cooldown protects subsequent runs even if execution crashes mid-way.
      const attemptedAt = new Date().toISOString();
      await (supabaseAdmin.from('contest_letters') as any)
        .update({ autopay_attempted_at: attemptedAt })
        .eq('id', letter.id);

      const execResult = executionMode === 'live'
        ? await executeLiveStripeCharge({
            contestLetterId: letter.id,
            ticketId: letter.ticket_id,
            userId: letter.user_id,
            finalAmount: letter.final_amount,
            paymentMethodId: resolvedPaymentMethodId,
            stripeCustomerId: profile.stripe_customer_id,
            userEmail: profile.email,
          })
        : executeSimulatedAutopay({
            contestLetterId: letter.id,
            finalAmount: letter.final_amount,
            paymentMethodId: resolvedPaymentMethodId,
          });

      if (execResult.success) {
        // Branch on whether the city leg is also done (simulate) or still
        // pending an out-of-process Playwright run (live).
        const cityLegSimulated = execResult.cityLegStatus === 'simulated';

        const successPatch = cityLegSimulated
          ? {
              // Simulate mode: city is fake, mark fully paid now.
              paid_at: new Date().toISOString(),
              payment_amount: execResult.amountCharged,
              payment_reference: (execResult as any).cityPaymentReference,
              stripe_payment_intent_id: execResult.stripePaymentIntentId,
              payment_source: 'autopay_simulated',
              lifecycle_status: 'paid',
              lifecycle_status_changed_at: new Date().toISOString(),
              autopay_status: 'paid',
              autopay_result_payload: {
                ...evaluationPatch.autopay_result_payload,
                executedAt: new Date().toISOString(),
                executionResult: execResult,
              },
            }
          : {
              // Live mode: Stripe is real, city leg is queued. Letter is
              // NOT yet considered paid — only the city worker can flip it.
              stripe_payment_intent_id: execResult.stripePaymentIntentId,
              payment_amount: execResult.amountCharged,
              payment_source: 'autopay_live',
              autopay_status: 'charged_pending_city',
              autopay_result_payload: {
                ...evaluationPatch.autopay_result_payload,
                stripeChargedAt: new Date().toISOString(),
                executionResult: execResult,
              },
            };
        const { error: payUpdateErr } = await (supabaseAdmin.from('contest_letters') as any)
          .update(successPatch)
          .eq('id', letter.id);
        if (payUpdateErr) throw new Error(`Charge-update failed: ${payUpdateErr.message}`);

        // For live mode, also enqueue the city payment job. The local
        // worker (scripts/run-city-payment-queue.ts) will pick it up.
        if (!cityLegSimulated) {
          // We need ticket_number + plate for the city portal lookup.
          // Pull from detected_tickets via the contest letter's ticket_id.
          const { data: ticket } = await supabaseAdmin
            .from('detected_tickets')
            .select('ticket_number, plate, state')
            .eq('id', letter.ticket_id)
            .maybeSingle();
          if (ticket?.ticket_number && ticket?.plate) {
            const enq = await enqueueCityPayment(supabaseAdmin as any, {
              contestLetterId: letter.id,
              ticketId: letter.ticket_id,
              userId: letter.user_id,
              ticketNumber: ticket.ticket_number,
              plate: ticket.plate,
              state: ticket.state || 'IL',
              amountCents: Math.round(execResult.amountCharged * 100),
              stripePaymentIntentId: execResult.stripePaymentIntentId,
            });
            if (enq.error) {
              throw new Error(`City queue insert failed: ${enq.error}`);
            }
          } else {
            // Stripe charged but we can't find the ticket data to queue
            // the city payment. Operator alert + flag for manual.
            console.error(`Stripe charged for ${letter.id} but ticket lookup failed for city queue`);
            await sendAutopayOperatorAlert({
              subject: `[Autopay live] Stripe charged but city queue insert blocked for ${letter.id}`,
              text: `Stripe PI ${execResult.stripePaymentIntentId} succeeded but detected_tickets lookup for ticket_id=${letter.ticket_id} found no ticket_number/plate. Letter is in autopay_status='charged_pending_city' and needs manual reconciliation.`,
              html: `<p><strong>Manual reconciliation needed</strong></p><p>Letter: <code>${letter.id}</code></p><p>Stripe PI: <code>${execResult.stripePaymentIntentId}</code></p><p>The Stripe charge succeeded but we could not enqueue the city payment because detected_tickets has no ticket_number/plate for ticket_id=<code>${letter.ticket_id}</code>.</p>`,
            }).catch((e) => console.error(`Failed to send city-queue-blocked alert: ${e.message}`));
          }
        }

        if (cityLegSimulated) {
          results.executedSimulated++;
        } else {
          results.executedSimulated++; // shared counter; live counter could be split later
        }

        await recordContestStatusEvent(supabaseAdmin as any, {
          contestLetterId: letter.id,
          ticketId: letter.ticket_id,
          userId: letter.user_id,
          eventType: cityLegSimulated ? 'autopay_executed_simulated' : 'autopay_stripe_charged_pending_city',
          source: 'autopay_executor',
          normalizedStatus: cityLegSimulated ? 'paid' : 'lost',
          rawStatus: cityLegSimulated ? (execResult as any).cityPaymentReference : execResult.stripePaymentIntentId,
          details: {
            stripePaymentIntentId: execResult.stripePaymentIntentId,
            cityPaymentReference: (execResult as any).cityPaymentReference || null,
            cityLegStatus: execResult.cityLegStatus,
            amountCharged: execResult.amountCharged,
            email: profile.email,
          },
        });

        // Only send the "we paid your ticket" email when the city leg is
        // actually done. In live mode we wait for the city worker script
        // to confirm — it sends the email itself after city accepts.
        if (cityLegSimulated && profile.email) {
          await sendAutopayPaidEmail({
            to: profile.email,
            firstName: profile.first_name,
            ticketNumber: null,
            amountCharged: execResult.amountCharged,
            cityPaymentReference: (execResult as any).cityPaymentReference,
            isSimulated: true,
          }).catch((emailErr) => {
            console.error(`Failed to send autopay-paid user email for ${letter.id}: ${emailErr.message}`);
          });
        }

        await sendAutopayOperatorAlert({
          subject: cityLegSimulated
            ? `[Autopay simulate] Executed for contest letter ${letter.id}`
            : `[Autopay live] Stripe charged, city queued for ${letter.id}`,
          text: [
            `Contest letter: ${letter.id}`,
            `Ticket: ${letter.ticket_id}`,
            `User: ${letter.user_id}`,
            `Email: ${profile.email || 'unknown'}`,
            `Amount: $${execResult.amountCharged.toFixed(2)}`,
            cityLegSimulated
              ? `Stripe (simulated): ${execResult.stripePaymentIntentId}`
              : `Stripe (LIVE): ${execResult.stripePaymentIntentId}`,
            cityLegSimulated
              ? `City (simulated): ${(execResult as any).cityPaymentReference}`
              : `City: queued — local worker will pay`,
          ].join('\n'),
          html: `
            <p><strong>${cityLegSimulated ? 'Autopay simulated execution complete' : 'Autopay LIVE — Stripe charged, city payment queued'}</strong></p>
            <p>Contest letter: <code>${letter.id}</code></p>
            <p>Ticket: <code>${letter.ticket_id}</code></p>
            <p>User: <code>${letter.user_id}</code></p>
            <p>Email: ${profile.email || 'unknown'}</p>
            <p>Amount: $${execResult.amountCharged.toFixed(2)}</p>
            <p>Stripe ${cityLegSimulated ? '(simulated)' : '(LIVE)'}: <code>${execResult.stripePaymentIntentId}</code></p>
            <p>City: ${cityLegSimulated ? `<code>${(execResult as any).cityPaymentReference}</code>` : 'queued — awaiting local worker'}</p>
          `,
        }).catch((alertErr) => {
          console.error(`Failed to send autopay-executed operator alert for ${letter.id}: ${alertErr.message}`);
        });
      } else {
        results.executionFailed++;
        // TS narrowing on `execResult` is unreliable across the awaits in
        // the success branch above; pull `error` out explicitly to keep
        // the rest of this block clean.
        const failError = (execResult as { success: false; error: string; mode: string }).error;
        const failMode = (execResult as { success: false; error: string; mode: string }).mode;

        const failPatch = {
          autopay_status: 'payment_failed',
          lifecycle_status: 'payment_failed',
          lifecycle_status_changed_at: new Date().toISOString(),
          autopay_result_payload: {
            ...evaluationPatch.autopay_result_payload,
            executionAttemptedAt: attemptedAt,
            executionResult: execResult,
          },
        };
        await (supabaseAdmin.from('contest_letters') as any)
          .update(failPatch)
          .eq('id', letter.id);

        await recordContestStatusEvent(supabaseAdmin as any, {
          contestLetterId: letter.id,
          ticketId: letter.ticket_id,
          userId: letter.user_id,
          eventType: 'autopay_execution_failed',
          source: 'autopay_executor',
          normalizedStatus: 'payment_failed',
          rawStatus: failError,
          details: {
            error: failError,
            mode: failMode,
            email: profile.email,
          },
        });

        if (profile.email) {
          await sendAutopayFailedEmail({
            to: profile.email,
            firstName: profile.first_name,
            ticketNumber: null,
            finalAmount: letter.final_amount,
            errorMessage: failError,
          }).catch((emailErr) => {
            console.error(`Failed to send autopay-failed user email for ${letter.id}: ${emailErr.message}`);
          });
        }

        await sendAutopayOperatorAlert({
          subject: `[Autopay simulate] Execution failed for contest letter ${letter.id}`,
          text: [
            `Contest letter: ${letter.id}`,
            `Ticket: ${letter.ticket_id}`,
            `User: ${letter.user_id}`,
            `Email: ${profile.email || 'unknown'}`,
            `Error: ${failError}`,
          ].join('\n'),
          html: `
            <p><strong>Autopay simulated execution failed</strong></p>
            <p>Contest letter: <code>${letter.id}</code></p>
            <p>Ticket: <code>${letter.ticket_id}</code></p>
            <p>User: <code>${letter.user_id}</code></p>
            <p>Email: ${profile.email || 'unknown'}</p>
            <p>Error: ${failError}</p>
          `,
        }).catch((alertErr) => {
          console.error(`Failed to send autopay-failed operator alert for ${letter.id}: ${alertErr.message}`);
        });
      }
    } catch (e: any) {
      results.errors.push(`${letter.id}: ${e?.message || String(e)}`);
      await sendAutopayOperatorAlert({
        subject: `[Autopay] Executor failure for contest letter ${letter.id}`,
        text: [
          `Contest letter: ${letter.id}`,
          `Ticket: ${letter.ticket_id}`,
          `User: ${letter.user_id}`,
          `Error: ${e?.message || String(e)}`,
        ].join('\n'),
        html: `
          <p><strong>Autopay executor failure</strong></p>
          <p>Contest letter: <code>${letter.id}</code></p>
          <p>Ticket: <code>${letter.ticket_id}</code></p>
          <p>User: <code>${letter.user_id}</code></p>
          <p>Error: ${e?.message || String(e)}</p>
        `,
      }).catch((alertErr) => {
        console.error(`Failed to send autopay failure alert for ${letter.id}: ${alertErr.message}`);
      });
    }
  }

  return res.status(200).json({
    success: true,
    ...results,
  });
}
