import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, licensePlate, billingPlan, formData } = req.body;

  try {
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'TicketlessChicago PRO - Complete Vehicle Compliance Service',
              description: `Hands-off vehicle compliance: We handle city sticker & license renewals, plus all alerts for ${licensePlate}`
            },
            unit_amount: billingPlan === 'annual' ? 10000 : 1000, // $100/year or $10/month
            recurring: {
              interval: billingPlan === 'annual' ? 'year' : 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://ticketlesschicago.com'}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://ticketlesschicago.com'}/`,
      customer_email: email,
      metadata: {
        email,
        licensePlate,
        billingPlan,
        formData: JSON.stringify(formData)
      }
    });

    res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
}