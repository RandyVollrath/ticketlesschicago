import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

export const config = {
  api: {
    bodyParser: false
  }
};

async function buffer(readable: any) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature']!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      buf.toString(),
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    console.error('Webhook error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('Webhook received:', event.type, event.id);

  // Handle the events
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('Checkout session completed:', session.id);
      console.log('Session client_reference_id (Rewardful ID):', session.client_reference_id);

      const rewardfulReferralId = session.client_reference_id;
      
      if (rewardfulReferralId) {
        console.log('Rewardful referral ID found:', rewardfulReferralId);
        
        // Notify Rewardful about the conversion
        try {
          const rewardfulConversionData = {
            referral: rewardfulReferralId,
            amount: session.amount_total || 0, // Amount in cents (Rewardful expects cents)
            currency: (session.currency || 'usd').toUpperCase(),
            external_id: session.id, // Unique identifier for this conversion
            email: session.customer_details?.email || session.customer_email || 'unknown'
          };
          
          console.log('Sending conversion to Rewardful:', rewardfulConversionData);
          
          const rewardfulResponse = await fetch('https://api.rewardful.com/conversions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.REWARDFUL_API_SECRET}`
            },
            body: JSON.stringify(rewardfulConversionData)
          });
          
          if (rewardfulResponse.ok) {
            console.log('✅ Successfully reported conversion to Rewardful');
          } else {
            const errorText = await rewardfulResponse.text();
            console.error('❌ Failed to report conversion to Rewardful:', rewardfulResponse.status, errorText);
          }
        } catch (rewardfulError) {
          console.error('❌ Error reporting to Rewardful:', rewardfulError);
        }
      } else {
        console.log('No Rewardful referral ID found in session');
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.status(200).json({ received: true });
}