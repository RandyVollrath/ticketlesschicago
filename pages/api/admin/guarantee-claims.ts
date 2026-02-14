import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../../lib/supabase';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { ACTIVE_AUTOPILOT_PLAN } from '../../../lib/autopilot-plans';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
  : null;

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method === 'GET') {
    const { data, error } = await supabaseAdmin
      .from('guarantee_claims')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch guarantee claims' });
    }

    return res.status(200).json({ claims: data || [] });
  }

  if (req.method === 'PATCH') {
    const { id, status, notes, denyReason, issueRefund } = req.body || {};

    if (!id || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const updateData: Record<string, any> = {
      status,
      notes: notes || null,
      deny_reason: denyReason || null,
      reviewed_by: adminUser.email,
      reviewed_at: new Date().toISOString(),
    };

    let stripeRefundId: string | null = null;

    if (issueRefund === true) {
      if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured on server' });
      }

      const { data: claim, error: claimError } = await supabaseAdmin
        .from('guarantee_claims')
        .select('id, user_id')
        .eq('id', id)
        .single();

      if (claimError || !claim?.user_id) {
        return res.status(404).json({ error: 'Guarantee claim not found' });
      }

      const { data: sub, error: subError } = await supabaseAdmin
        .from('autopilot_subscriptions')
        .select('stripe_subscription_id')
        .eq('user_id', claim.user_id)
        .single();

      if (subError || !sub?.stripe_subscription_id) {
        return res.status(400).json({ error: 'No active subscription found for refund' });
      }

      const subscription = await stripe.subscriptions.retrieve(sub.stripe_subscription_id, {
        expand: ['latest_invoice.payment_intent'],
      });

      const paymentIntent = subscription.latest_invoice && typeof subscription.latest_invoice !== 'string'
        ? (subscription.latest_invoice as any).payment_intent
        : null;

      const paymentIntentId = paymentIntent && typeof paymentIntent !== 'string' ? paymentIntent.id : null;

      if (!paymentIntentId) {
        return res.status(400).json({ error: 'Could not locate original payment for refund' });
      }

      const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: ACTIVE_AUTOPILOT_PLAN.priceCents,
        metadata: {
          source: 'first_dismissal_guarantee',
          claim_id: id,
        },
      });

      stripeRefundId = refund.id;
      updateData.status = 'refunded';
      updateData.refund_amount_cents = ACTIVE_AUTOPILOT_PLAN.priceCents;
      updateData.stripe_refund_id = stripeRefundId;
      updateData.refund_issued_at = new Date().toISOString();
    }

    const { error } = await supabaseAdmin
      .from('guarantee_claims')
      .update(updateData)
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: 'Failed to update guarantee claim' });
    }

    return res.status(200).json({ success: true, stripeRefundId });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
