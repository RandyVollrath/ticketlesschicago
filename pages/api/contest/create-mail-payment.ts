import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

const MAIL_SERVICE_COST = 500; // $5.00 in cents
// Note: Stripe Price ID for mail service: price_1SPELQPSdzV8LIExv2ocaI0A
// (Currently using PaymentIntent directly for more flexible one-time payments)

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { userId, contestId, mailingAddress, signature } = req.body;

  // Validate input
  if (!userId || !contestId || !mailingAddress) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!signature) {
    return res.status(400).json({ error: 'Signature required' });
  }

  const { name, address, city, state, zip } = mailingAddress;
  if (!name || !address || !city || !state || !zip) {
    return res.status(400).json({ error: 'Incomplete mailing address' });
  }

  try {
    // Get user email
    const { data: user, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('email')
      .eq('user_id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify contest exists and belongs to user
    const { data: contest, error: contestError } = await supabaseAdmin
      .from('ticket_contests')
      .select('id, ticket_number')
      .eq('id', contestId)
      .eq('user_id', userId)
      .single();

    if (contestError || !contest) {
      return res.status(404).json({ error: 'Contest not found' });
    }

    // Check if mail service already paid for this contest
    if (contest.mail_service_payment_intent) {
      return res.status(400).json({ error: 'Mail service already paid for this contest' });
    }

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: MAIL_SERVICE_COST,
      currency: 'usd',
      metadata: {
        userId,
        contestId,
        service: 'contest_letter_mailing',
        mailingAddress: JSON.stringify(mailingAddress),
        hasSignature: 'true'
      },
      description: `Mail contest letter to ${name}`,
      receipt_email: user.email
    });

    // Update contest record with payment info and signature
    const { error: updateError } = await supabaseAdmin
      .from('ticket_contests')
      .update({
        mail_service_requested: true,
        mail_service_payment_intent: paymentIntent.id,
        mail_service_payment_status: 'pending',
        mail_service_amount: MAIL_SERVICE_COST / 100,
        mailing_address: mailingAddress,
        mail_status: 'pending',
        extracted_data: {
          ...(contest.extracted_data || {}),
          signature: signature
        }
      })
      .eq('id', contestId);

    if (updateError) {
      console.error('Database error:', updateError);
      await stripe.paymentIntents.cancel(paymentIntent.id);
      return res.status(500).json({ error: 'Failed to update contest record' });
    }

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: MAIL_SERVICE_COST / 100
    });

  } catch (error: any) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
