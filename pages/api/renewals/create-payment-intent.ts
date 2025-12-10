import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Renewal costs (in cents) - these should be configurable
const RENEWAL_COSTS = {
  city_sticker: 10000, // $100.00
  license_plate: 15500, // $155.00
  emissions: 2500 // $25.00
};

// Service fees (in cents)
const SERVICE_FEE_RATE = 0.035; // 3.5%
const SERVICE_FEE_FIXED = 299; // $2.99

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, renewalType, licensePlate, dueDate } = req.body;

  // Validate input
  if (!userId || !renewalType || !licensePlate || !dueDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!RENEWAL_COSTS[renewalType as keyof typeof RENEWAL_COSTS]) {
    return res.status(400).json({ error: 'Invalid renewal type' });
  }

  try {
    // Get user information
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('email, first_name, last_name')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Calculate fees
    const renewalAmount = RENEWAL_COSTS[renewalType as keyof typeof RENEWAL_COSTS];
    const serviceFeeVariable = Math.round(renewalAmount * SERVICE_FEE_RATE);
    const serviceFee = serviceFeeVariable + SERVICE_FEE_FIXED;
    const totalAmount = renewalAmount + serviceFee;

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalAmount,
      currency: 'usd',
      metadata: {
        userId,
        renewalType,
        licensePlate,
        dueDate,
        renewalAmount: (renewalAmount / 100).toString(),
        serviceFee: (serviceFee / 100).toString(),
        totalAmount: (totalAmount / 100).toString()
      },
      description: `${renewalType.replace('_', ' ').toUpperCase()} renewal for ${licensePlate}`,
      receipt_email: user.email
    });

    // Store payment record in database
    const { error: dbError } = await supabase
      .from('renewal_payments')
      .insert({
        user_id: userId,
        renewal_type: renewalType,
        license_plate: licensePlate,
        renewal_amount: renewalAmount / 100, // Convert to dollars
        service_fee: serviceFee / 100,
        total_amount: totalAmount / 100,
        stripe_payment_intent_id: paymentIntent.id,
        due_date: dueDate,
        metadata: {
          customer_name: `${user.first_name} ${user.last_name}`.trim(),
          customer_email: user.email
        }
      });

    if (dbError) {
      console.error('Database error:', dbError);
      // Cancel the payment intent since we couldn't store the record
      await stripe.paymentIntents.cancel(paymentIntent.id);
      return res.status(500).json({ error: 'Failed to create payment record' });
    }

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: totalAmount,
      breakdown: {
        renewalAmount: renewalAmount / 100,
        serviceFee: serviceFee / 100,
        total: totalAmount / 100
      }
    });

  } catch (error: any) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}