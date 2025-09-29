import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { paymentIntentId } = req.body;

  if (!paymentIntentId) {
    return res.status(400).json({ error: 'Payment intent ID required' });
  }

  try {
    // Verify payment with Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: 'Payment not successful' });
    }

    // Update payment record in database
    const { data: paymentRecord, error: updateError } = await supabase
      .from('renewal_payments')
      .update({
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        metadata: {
          ...paymentRecord?.metadata,
          stripe_payment_method: paymentIntent.payment_method,
          stripe_receipt_url: paymentIntent.charges?.data[0]?.receipt_url
        }
      })
      .eq('stripe_payment_intent_id', paymentIntentId)
      .select()
      .single();

    if (updateError) {
      console.error('Database update error:', updateError);
      return res.status(500).json({ error: 'Failed to update payment record' });
    }

    // Get user details for notification
    const { data: user, error: userError } = await supabase
      .from('user_profiles')
      .select('email, first_name, last_name, phone_number')
      .eq('user_id', paymentRecord.user_id)
      .single();

    if (!userError && user) {
      // TODO: Send confirmation email to customer
      // TODO: Queue city payment processing
      // TODO: Add to reconciliation queue
      
      // For now, log the successful payment
      console.log('Payment confirmed:', {
        paymentId: paymentRecord.id,
        user: user.email,
        renewalType: paymentRecord.renewal_type,
        licensePlate: paymentRecord.license_plate,
        amount: paymentRecord.total_amount
      });
    }

    res.status(200).json({
      success: true,
      paymentRecord: {
        id: paymentRecord.id,
        renewalType: paymentRecord.renewal_type,
        licensePlate: paymentRecord.license_plate,
        totalAmount: paymentRecord.total_amount,
        dueDate: paymentRecord.due_date
      }
    });

  } catch (error: any) {
    console.error('Payment confirmation error:', error);
    res.status(500).json({ error: error.message });
  }
}