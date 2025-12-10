/**
 * Create a test Stripe Connect payment to unlock live mode
 * Visit this endpoint once to satisfy Stripe's testing requirement
 */

import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Get test partner
    const { data: partner } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('id', 'd78e9928-613f-4f1d-b63a-cda5cb20eef0')
      .single();

    if (!partner || !partner.stripe_connected_account_id) {
      return res.status(400).json({
        error: 'Partner not connected. Visit /api/stripe-connect/authorize first'
      });
    }

    // Create a test payment that goes to the connected account
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 10200, // $102.00
      currency: 'usd',
      payment_method: 'pm_card_visa', // Stripe test payment method
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      description: 'Test payment to unlock Stripe Connect',

      // Send to remitter
      transfer_data: {
        destination: partner.stripe_connected_account_id,
      },

      // Your $2 fee
      application_fee_amount: 200,
    });

    // Log in database
    await supabase.from('renewal_orders').insert({
      order_number: 'TEST-' + Date.now(),
      partner_id: partner.id,
      customer_name: 'Test Customer',
      customer_email: 'test@test.com',
      customer_phone: '3125551234',
      license_plate: 'TEST123',
      license_state: 'IL',
      street_address: '123 Test St',
      city: 'Chicago',
      state: 'IL',
      zip_code: '60601',
      sticker_type: 'passenger',
      sticker_price: 100,
      service_fee: 2,
      total_amount: 102,
      payment_status: 'paid',
      status: 'completed',
      stripe_payment_intent_id: paymentIntent.id,
    });

    return res.status(200).json({
      success: true,
      message: 'Test payment completed! Stripe Connect should be unlocked for live mode now.',
      paymentIntent: {
        id: paymentIntent.id,
        amount: paymentIntent.amount,
        status: paymentIntent.status,
      },
      instructions: [
        '1. Go to Stripe Dashboard',
        '2. Toggle to LIVE mode (top right)',
        '3. Check if Connect setup is unlocked',
        '4. If unlocked, switch your Vercel env vars to live keys',
      ],
    });

  } catch (error: any) {
    console.error('Test payment error:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
