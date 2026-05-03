import type { NextApiRequest, NextApiResponse } from 'next';
import { isAutopayBetaAllowed } from '../../../lib/autopay-beta';
import { handleAuthError, requireAuth } from '../../../lib/auth-middleware';
import { evaluateAutopayEligibility, recordContestStatusEvent } from '../../../lib/contest-lifecycle';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { resolveDefaultStripePaymentMethod } from '../../../lib/stripe-default-payment-method';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Supabase admin client unavailable' });
  }

  let user;
  try {
    user = await requireAuth(req);
  } catch (error: any) {
    return handleAuthError(res, error);
  }

  try {
    if (req.method === 'GET') {
      const contestLetterId = String(req.query.id || '');
      if (!contestLetterId) return res.status(400).json({ error: 'Missing id' });

      const { data: letter, error } = await supabaseAdmin
        .from('contest_letters')
        .select('id, user_id, ticket_id, lifecycle_status, final_amount, autopay_opt_in, autopay_mode, autopay_cap_amount, autopay_payment_method_id, autopay_status')
        .eq('id', contestLetterId)
        .maybeSingle();

      if (error || !letter || letter.user_id !== user.id) {
        return res.status(404).json({ error: 'Contest letter not found' });
      }

      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();

      const eligibility = evaluateAutopayEligibility({
        lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
        autopayOptIn: letter.autopay_opt_in,
        autopayMode: letter.autopay_mode,
        autopayCapAmount: letter.autopay_cap_amount,
        paymentMethodId: letter.autopay_payment_method_id,
        finalAmount: letter.final_amount,
      });
      const betaAllowance = isAutopayBetaAllowed({
        userId: user.id,
        userEmail: user.email || null,
        contestLetterId: letter.id,
        ticketId: letter.ticket_id,
      });

      return res.status(200).json({
        success: true,
        autopay: {
          ...letter,
          stripe_customer_id: profile?.stripe_customer_id || null,
          eligibility,
          betaAllowance,
        },
      });
    }

    if (req.method === 'POST') {
      const {
        contestLetterId,
        autopayOptIn,
        autopayMode,
        autopayCapAmount,
        refreshDefaultPaymentMethod,
      } = req.body || {};

      if (!contestLetterId) return res.status(400).json({ error: 'Missing contestLetterId' });

      const { data: letter, error } = await supabaseAdmin
        .from('contest_letters')
        .select('id, user_id, ticket_id, lifecycle_status, final_amount, autopay_payment_method_id')
        .eq('id', contestLetterId)
        .maybeSingle();

      if (error || !letter || letter.user_id !== user.id) {
        return res.status(404).json({ error: 'Contest letter not found' });
      }

      const { data: profile } = await supabaseAdmin
        .from('user_profiles')
        .select('stripe_customer_id')
        .eq('user_id', user.id)
        .maybeSingle();

      let paymentMethodId = letter.autopay_payment_method_id;
      let resolvedSource = paymentMethodId ? 'stored_on_letter' : 'none';

      if ((!paymentMethodId || refreshDefaultPaymentMethod) && profile?.stripe_customer_id) {
        const resolved = await resolveDefaultStripePaymentMethod(profile.stripe_customer_id);
        paymentMethodId = resolved.paymentMethodId;
        resolvedSource = resolved.source;
      }

      const eligibility = evaluateAutopayEligibility({
        lifecycleStatus: (letter.lifecycle_status as any) || 'lost',
        autopayOptIn: !!autopayOptIn,
        autopayMode: autopayMode || null,
        autopayCapAmount: autopayCapAmount ?? null,
        paymentMethodId,
        finalAmount: letter.final_amount,
      });
      const betaAllowance = isAutopayBetaAllowed({
        userId: user.id,
        userEmail: user.email || null,
        contestLetterId: letter.id,
        ticketId: letter.ticket_id,
      });

      const patch = {
        autopay_opt_in: !!autopayOptIn,
        autopay_mode: autopayMode || null,
        autopay_cap_amount: autopayCapAmount ?? null,
        autopay_payment_method_id: paymentMethodId,
        autopay_authorized_at: !!autopayOptIn ? new Date().toISOString() : null,
        autopay_status: eligibility.status,
        autopay_result_payload: {
          reason: eligibility.reason,
          configuredBy: user.email || user.id,
          resolvedSource,
          configuredAt: new Date().toISOString(),
          hiddenEndpoint: true,
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
        source: 'user_hidden_api',
        normalizedStatus: letter.lifecycle_status,
        rawStatus: eligibility.status,
        details: {
          autopayOptIn: !!autopayOptIn,
          autopayMode: autopayMode || null,
          autopayCapAmount: autopayCapAmount ?? null,
          resolvedSource,
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

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error('Contest autopay config error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
