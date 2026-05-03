import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendAutopayOperatorAlert } from '../../../lib/autopay-alerts';
import { getAutopayBetaConfig, isAutopayBetaAllowed } from '../../../lib/autopay-beta';
import { evaluateAutopayEligibility, recordContestStatusEvent } from '../../../lib/contest-lifecycle';
import { resolveDefaultStripePaymentMethod } from '../../../lib/stripe-default-payment-method';

export const config = { maxDuration: 60 };

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

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
  paid_at: string | null;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const enableCityAutopay = process.env.ENABLE_CITY_AUTOPAY === '1';
  const betaConfig = getAutopayBetaConfig();

  const results = {
    checked: 0,
    eligible: 0,
    blocked: 0,
    notEnabled: 0,
    betaBlocked: 0,
    readyButNotExecuted: 0,
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
      const eligibility = evaluateAutopayEligibility({
        lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
        autopayOptIn: letter.autopay_opt_in,
        autopayMode: letter.autopay_mode,
        autopayCapAmount: letter.autopay_cap_amount,
        paymentMethodId: letter.autopay_payment_method_id,
        finalAmount: letter.final_amount,
      });

      let resolvedPaymentMethodId = letter.autopay_payment_method_id;
      let resolvedSource = resolvedPaymentMethodId ? 'stored_on_letter' : 'none';
      let profile: { stripe_customer_id: string | null; email: string | null } | null = null;

      if (!resolvedPaymentMethodId) {
        const { data: profileData } = await supabaseAdmin
          .from('user_profiles')
          .select('stripe_customer_id, email')
          .eq('user_id', letter.user_id)
          .maybeSingle();
        profile = profileData || null;
      }

      if (!resolvedPaymentMethodId && profile?.stripe_customer_id) {
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
        userEmail: profile?.email || null,
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

      const patch = {
        autopay_payment_method_id: resolvedPaymentMethodId,
        autopay_status: effectiveStatus,
        autopay_result_payload: {
          reason: effectiveReason,
          evaluatedAt: new Date().toISOString(),
          executor: 'autopilot-autopay-executor',
          executionEnabled: enableCityAutopay,
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
        .update(patch)
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
          executionEnabled: enableCityAutopay,
          resolvedPaymentMethodSource: resolvedSource,
        },
      });

      if (finalEligibility.status === 'eligible' && !betaAllowance.allowed) {
        results.betaBlocked++;
      }

      if (finalEligibility.status === 'eligible' && betaAllowance.allowed) {
        results.eligible++;
        if (!enableCityAutopay) {
          results.readyButNotExecuted++;
        } else {
          await recordContestStatusEvent(supabaseAdmin as any, {
            contestLetterId: letter.id,
            ticketId: letter.ticket_id,
            userId: letter.user_id,
            eventType: 'autopay_execution_deferred',
            source: 'autopay_executor',
            normalizedStatus: letter.lifecycle_status,
            rawStatus: 'execution_not_implemented',
            details: {
              reason: 'City payment execution not implemented yet',
              finalAmount: letter.final_amount,
              email: profile?.email || null,
            },
          });
          await sendAutopayOperatorAlert({
            subject: `[Autopay beta] Execution deferred for contest letter ${letter.id}`,
            text: [
              `Contest letter: ${letter.id}`,
              `Ticket: ${letter.ticket_id}`,
              `User: ${letter.user_id}`,
              `Email: ${profile?.email || 'unknown'}`,
              `Amount: ${letter.final_amount ?? 'unknown'}`,
              `Reason: City payment execution not implemented yet`,
            ].join('\n'),
            html: `
              <p><strong>Autopay beta execution deferred</strong></p>
              <p>Contest letter: <code>${letter.id}</code></p>
              <p>Ticket: <code>${letter.ticket_id}</code></p>
              <p>User: <code>${letter.user_id}</code></p>
              <p>Email: ${profile?.email || 'unknown'}</p>
              <p>Amount: ${letter.final_amount ?? 'unknown'}</p>
              <p>Reason: City payment execution not implemented yet.</p>
            `,
          }).catch((err) => {
            console.error(`Failed to send autopay deferred alert for ${letter.id}: ${err.message}`);
          });
        }
      } else if (effectiveStatus === 'blocked') {
        results.blocked++;
        if (finalEligibility.status === 'eligible' && !betaAllowance.allowed) {
          await recordContestStatusEvent(supabaseAdmin as any, {
            contestLetterId: letter.id,
            ticketId: letter.ticket_id,
            userId: letter.user_id,
            eventType: 'autopay_beta_blocked',
            source: 'autopay_executor',
            normalizedStatus: letter.lifecycle_status,
            rawStatus: betaAllowance.reason,
            details: {
              email: profile?.email || null,
              betaAllowance,
              finalAmount: letter.final_amount,
            },
          });
        }
      } else {
        results.notEnabled++;
      }
    } catch (e: any) {
      results.errors.push(`${letter.id}: ${e?.message || String(e)}`);
      await sendAutopayOperatorAlert({
        subject: `[Autopay beta] Executor failure for contest letter ${letter.id}`,
        text: [
          `Contest letter: ${letter.id}`,
          `Ticket: ${letter.ticket_id}`,
          `User: ${letter.user_id}`,
          `Error: ${e?.message || String(e)}`,
        ].join('\n'),
        html: `
          <p><strong>Autopay beta executor failure</strong></p>
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
    executionEnabled: enableCityAutopay,
    ...results,
  });
}
