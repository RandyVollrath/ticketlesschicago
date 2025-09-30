import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { billingPlan, email, userId } = req.body;

  if (!email || !billingPlan) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (billingPlan !== 'monthly' && billingPlan !== 'annual') {
    return res.status(400).json({ error: 'Invalid billing plan' });
  }

  try {
    // Create Stripe price IDs based on plan
    // You'll need to create these products in Stripe Dashboard
    const priceId = billingPlan === 'monthly'
      ? process.env.STRIPE_PROTECTION_MONTHLY_PRICE_ID
      : process.env.STRIPE_PROTECTION_ANNUAL_PRICE_ID;

    if (!priceId) {
      throw new Error('Stripe price ID not configured');
    }

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      client_reference_id: userId || undefined,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/alerts/success?protection=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/protection`,
      metadata: {
        userId: userId || '',
        plan: billingPlan,
        product: 'ticket_protection'
      }
    });

    console.log('✅ Stripe checkout session created:', session.id);

    return res.status(200).json({
      sessionId: session.id,
      url: session.url
    });

  } catch (error: any) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}