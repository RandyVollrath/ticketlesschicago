import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, licensePlate, service } = req.body;

  try {
    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: service === 'both' 
                ? 'TicketlessChicago - Full Year Service (City Sticker + Emissions)' 
                : 'TicketlessChicago - City Sticker Reminders',
              description: `Automated reminders for vehicle ${licensePlate}`
            },
            unit_amount: service === 'both' ? 1999 : 999, // $19.99 or $9.99
            recurring: {
              interval: 'year'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/`,
      customer_email: email,
      metadata: {
        email,
        licensePlate,
        service
      }
    });

    res.status(200).json({ sessionId: session.id, url: session.url });
  } catch (error: any) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: error.message });
  }
}