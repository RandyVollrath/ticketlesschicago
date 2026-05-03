import { NextApiRequest, NextApiResponse } from 'next';
import { getAutopayBetaConfig, isAutopayBetaAllowed } from '../../../lib/autopay-beta';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { evaluateAutopayEligibility, recordContestStatusEvent } from '../../../lib/contest-lifecycle';
import { resolveDefaultStripePaymentMethod } from '../../../lib/stripe-default-payment-method';
import { supabaseAdmin } from '../../../lib/supabase';

export default withAdminAuth(async (req: NextApiRequest, res: NextApiResponse, adminUser) => {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase admin client unavailable' });
  }

  try {
    if (req.method === 'GET') {
      const contestLetterId = String(req.query.id || '');
      if (!contestLetterId) return res.status(400).json({ error: 'Missing id' });

      const { data: letter, error } = await supabaseAdmin
        .from('contest_letters')
        .select(`
          *,
          detected_tickets (
            id,
            ticket_number,
            violation_description,
            amount,
            status,
            plate,
            state
          )
        `)
        .eq('id', contestLetterId)
        .maybeSingle();

      if (error || !letter) {
        return res.status(404).json({ error: 'Contest letter not found' });
      }

      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('user_id, email, stripe_customer_id')
        .eq('user_id', letter.user_id)
        .maybeSingle();

      const { data: events } = await (supabaseAdmin.from('contest_status_events') as any)
        .select('*')
        .eq('contest_letter_id', contestLetterId)
        .order('observed_at', { ascending: false })
        .limit(50);

      let defaultPaymentMethod: { paymentMethodId: string | null; source: string } | null = null;
      if (profile?.stripe_customer_id) {
        try {
          defaultPaymentMethod = await resolveDefaultStripePaymentMethod(profile.stripe_customer_id);
        } catch (err: any) {
          defaultPaymentMethod = { paymentMethodId: null, source: `error:${err.message}` };
        }
      }

      const eligibility = evaluateAutopayEligibility({
        lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
        autopayOptIn: letter.autopay_opt_in,
        autopayMode: letter.autopay_mode,
        autopayCapAmount: letter.autopay_cap_amount,
        paymentMethodId: letter.autopay_payment_method_id || defaultPaymentMethod?.paymentMethodId || null,
        finalAmount: letter.final_amount,
      });
      const betaAllowance = isAutopayBetaAllowed({
        userId: letter.user_id,
        userEmail: profile?.email || null,
        contestLetterId: letter.id,
        ticketId: letter.ticket_id,
      });

      return res.status(200).json({
        success: true,
        letter,
        profile: profile || null,
        events: events || [],
        beta: {
          config: getAutopayBetaConfig(),
          allowance: betaAllowance,
        },
        stripe: {
          stripe_customer_id: profile?.stripe_customer_id || null,
          resolved_default_payment_method: defaultPaymentMethod,
        },
        autopay: {
          eligibility,
        },
      });
    }

    if (req.method === 'POST') {
      const { contestLetterId, action } = req.body || {};
      if (!contestLetterId || !action) {
        return res.status(400).json({ error: 'Missing contestLetterId or action' });
      }

      const { data: letter, error } = await supabaseAdmin
        .from('contest_letters')
        .select('id, user_id, ticket_id, lifecycle_status, final_amount, autopay_opt_in, autopay_mode, autopay_cap_amount, autopay_payment_method_id')
        .eq('id', contestLetterId)
        .maybeSingle();

      if (error || !letter) {
        return res.status(404).json({ error: 'Contest letter not found' });
      }

      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('stripe_customer_id')
        .eq('user_id', letter.user_id)
        .maybeSingle();

      if (action === 'configure') {
        const {
          autopayOptIn,
          autopayMode,
          autopayCapAmount,
          autopayPaymentMethodId,
          resolveDefaultPaymentMethod,
        } = req.body || {};

        let resolvedPaymentMethodId = autopayPaymentMethodId || null;
        let resolvedSource = 'manual';

        if (!resolvedPaymentMethodId && resolveDefaultPaymentMethod && profile?.stripe_customer_id) {
          const resolved = await resolveDefaultStripePaymentMethod(profile.stripe_customer_id);
          resolvedPaymentMethodId = resolved.paymentMethodId;
          resolvedSource = resolved.source;
        }

        const eligibility = evaluateAutopayEligibility({
          lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
          autopayOptIn,
          autopayMode,
          autopayCapAmount,
          paymentMethodId: resolvedPaymentMethodId,
          finalAmount: letter.final_amount,
        });
        const betaAllowance = isAutopayBetaAllowed({
          userId: letter.user_id,
          userEmail: null,
          contestLetterId: letter.id,
          ticketId: letter.ticket_id,
        });

        const patch = {
          autopay_opt_in: !!autopayOptIn,
          autopay_mode: autopayMode || null,
          autopay_cap_amount: autopayCapAmount ?? null,
          autopay_payment_method_id: resolvedPaymentMethodId,
          autopay_authorized_at: !!autopayOptIn ? new Date().toISOString() : null,
          autopay_status: eligibility.status,
          autopay_result_payload: {
            reason: eligibility.reason,
            configuredBy: adminUser.email,
            resolvedSource,
            configuredAt: new Date().toISOString(),
          },
        };

        const { error: updateErr } = await (supabaseAdmin.from('contest_letters') as any)
          .update(patch)
          .eq('id', contestLetterId);

        if (updateErr) {
          return res.status(500).json({ error: sanitizeErrorMessage(updateErr) });
        }

        await recordContestStatusEvent(supabaseAdmin as any, {
          contestLetterId: letter.id,
          ticketId: letter.ticket_id,
          userId: letter.user_id,
          eventType: 'autopay_configured',
          source: 'admin',
          normalizedStatus: letter.lifecycle_status,
          rawStatus: eligibility.status,
          details: {
            autopayOptIn: !!autopayOptIn,
            autopayMode: autopayMode || null,
            autopayCapAmount: autopayCapAmount ?? null,
            resolvedPaymentMethodId,
            resolvedSource,
            configuredBy: adminUser.email,
          },
        });

        return res.status(200).json({
          success: true,
          autopay: {
            ...patch,
            eligibility,
            betaAllowance,
          },
        });
      }

      if (action === 'evaluate') {
        let paymentMethodId = letter.autopay_payment_method_id;
        let resolvedSource = 'stored_on_letter';

        if (!paymentMethodId && profile?.stripe_customer_id) {
          const resolved = await resolveDefaultStripePaymentMethod(profile.stripe_customer_id);
          paymentMethodId = resolved.paymentMethodId;
          resolvedSource = resolved.source;
        }

        const eligibility = evaluateAutopayEligibility({
          lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
          autopayOptIn: letter.autopay_opt_in,
          autopayMode: letter.autopay_mode,
          autopayCapAmount: letter.autopay_cap_amount,
          paymentMethodId,
          finalAmount: letter.final_amount,
        });
        const betaAllowance = isAutopayBetaAllowed({
          userId: letter.user_id,
          userEmail: null,
          contestLetterId: letter.id,
          ticketId: letter.ticket_id,
        });

        return res.status(200).json({
          success: true,
          eligibility,
          betaAllowance,
          resolvedPaymentMethodId: paymentMethodId,
          resolvedSource,
        });
      }

      return res.status(400).json({ error: 'Unsupported action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Admin contest autopay error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
