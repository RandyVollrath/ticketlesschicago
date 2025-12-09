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
  // SECURITY: Only allow in development mode
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  console.log('=== WEBHOOK DEBUG ENDPOINT ===');
  console.log('Method:', req.method);
  // SECURITY: Don't log full headers - log only non-sensitive ones
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Stripe-Signature:', req.headers['stripe-signature'] ? 'Present' : 'Missing');
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'] as string;
  
  console.log('Signature header:', sig ? 'Present' : 'MISSING');
  console.log('Body length:', buf.length);
  console.log('First 200 chars of body:', buf.toString().substring(0, 200));
  
  // Test with environment secret only
  const secrets = [
    process.env.STRIPE_WEBHOOK_SECRET
  ].filter(Boolean);
  
  let event: Stripe.Event | null = null;
  let workingSecret: string | null = null;
  
  for (const secret of secrets) {
    if (!secret) continue;
    
    try {
      event = stripe.webhooks.constructEvent(
        buf.toString(),
        sig,
        secret
      );
      workingSecret = secret;
      console.log('✅ Signature verified');
      break;
    } catch (err: any) {
      console.log(`❌ Signature verification failed: ${err.message}`);
    }
  }

  if (!event) {
    return res.status(400).json({
      error: 'Webhook signature verification failed',
      debug: {
        hasSignature: !!sig,
        bodyLength: buf.length,
        envSecretSet: !!process.env.STRIPE_WEBHOOK_SECRET,
        // SECURITY: Don't expose secret values
      }
    });
  }
  
  // Process the event
  console.log('Event type:', event.type);
  console.log('Event ID:', event.id);
  
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    console.log('Checkout session:', {
      id: session.id,
      customer_email: session.customer_details?.email,
      amount: session.amount_total,
      metadata: session.metadata
    });
  }
  
  res.status(200).json({
    received: true,
    eventType: event.type,
    // SECURITY: Don't expose secret values
  });
}