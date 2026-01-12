/**
 * Property Tax Success Fee Checkout
 *
 * Creates a Stripe Checkout session for the success fee (10% of savings)
 * This is triggered after a successful appeal outcome.
 *
 * POST /api/property-tax/success-fee-checkout
 * Body: { appealId: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import stripeConfig from '../../../lib/stripe-config';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Get site URL with Vercel preview fallback
function getSiteUrl(): string {
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  return 'http://localhost:3000';
}

const stripe = new Stripe(stripeConfig.secretKey!, {
  apiVersion: '2024-12-18.acacia',
});

// Success fee percentage
const SUCCESS_FEE_PERCENT = 0.10; // 10% of first-year savings
const MIN_SUCCESS_FEE = 5000; // Minimum $50 success fee
const MAX_SUCCESS_FEE = 50000; // Maximum $500 success fee

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Verify authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.substring(7);
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const { appealId } = req.body;

    if (!appealId) {
      return res.status(400).json({ error: 'Appeal ID required' });
    }

    // Get the appeal
    const { data: appeal, error: appealError } = await supabase
      .from('property_tax_appeals')
      .select(`
        id,
        user_id,
        pin,
        address,
        township,
        actual_tax_savings,
        status,
        success_fee_paid,
        success_fee_paid_at,
        success_fee_amount
      `)
      .eq('id', appealId)
      .eq('user_id', user.id)
      .single();

    if (appealError || !appeal) {
      return res.status(404).json({ error: 'Appeal not found' });
    }

    // Verify appeal was won
    if (appeal.status !== 'won') {
      return res.status(400).json({
        error: 'Appeal not won',
        message: 'Success fees only apply to successful appeals.'
      });
    }

    // Check if already paid
    if (appeal.success_fee_paid) {
      return res.status(400).json({
        error: 'Already paid',
        message: 'Success fee has already been paid for this appeal.',
        paidAt: appeal.success_fee_paid_at
      });
    }

    // Calculate success fee
    const actualSavings = appeal.actual_tax_savings || 0;
    if (actualSavings <= 0) {
      return res.status(400).json({
        error: 'No savings',
        message: 'No tax savings were recorded for this appeal.'
      });
    }

    // Calculate fee (10% of savings, capped)
    let successFeeAmount = Math.round(actualSavings * SUCCESS_FEE_PERCENT * 100); // in cents
    successFeeAmount = Math.max(MIN_SUCCESS_FEE, Math.min(successFeeAmount, MAX_SUCCESS_FEE));

    // Get or create Stripe customer
    const customers = await stripe.customers.list({ email: user.email!, limit: 1 });
    let customerId = customers.data[0]?.id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: { userId: user.id }
      });
      customerId = customer.id;
    }

    // Create checkout session with ad-hoc price
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: 'Property Tax Appeal Success Fee',
            description: `Success fee for ${appeal.address} (10% of $${actualSavings.toLocaleString()} savings)`,
          },
          unit_amount: successFeeAmount,
        },
        quantity: 1,
      }],
      success_url: `${getSiteUrl()}/property-tax/dashboard?success_fee=paid&appeal_id=${appealId}`,
      cancel_url: `${getSiteUrl()}/property-tax/dashboard?success_fee=canceled&appeal_id=${appealId}`,
      metadata: {
        product: 'property_tax_success_fee',
        userId: user.id,
        appealId: appealId,
        pin: appeal.pin,
        address: appeal.address,
        actualSavings: String(actualSavings),
        successFeeAmount: String(successFeeAmount / 100),
      },
      payment_intent_data: {
        metadata: {
          product: 'property_tax_success_fee',
          userId: user.id,
          appealId: appealId,
        },
      },
    });

    // Update appeal with pending success fee
    await supabase
      .from('property_tax_appeals')
      .update({
        success_fee_amount: successFeeAmount / 100,
        success_fee_checkout_session_id: session.id,
        updated_at: new Date().toISOString()
      })
      .eq('id', appealId);

    console.log('✅ Success fee checkout session created:', session.id);

    return res.status(200).json({
      sessionId: session.id,
      url: session.url,
      successFee: {
        amount: successFeeAmount / 100,
        savingsAmount: actualSavings,
        percentage: SUCCESS_FEE_PERCENT * 100
      }
    });

  } catch (error: any) {
    console.error('Success fee checkout error:', error);
    return res.status(500).json({
      error: 'Checkout failed',
      message: 'Unable to create checkout session. Please try again.'
    });
  }
}
