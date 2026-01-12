import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * This endpoint is called immediately after checkout redirect to ensure
 * the user is marked as paid without waiting for the webhook.
 *
 * It verifies the checkout was completed in Stripe and updates the database.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Get user's Stripe customer ID
    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('stripe_customer_id, has_contesting')
      .eq('user_id', userId)
      .single();

    // Also check autopilot_subscriptions for customer ID
    const { data: subscription } = await supabaseAdmin
      .from('autopilot_subscriptions')
      .select('stripe_customer_id, stripe_subscription_id, status')
      .eq('user_id', userId)
      .single();

    // If already marked as paid, return success
    if (profile?.has_contesting === true) {
      return res.status(200).json({ success: true, alreadyPaid: true });
    }

    const customerId = profile?.stripe_customer_id || subscription?.stripe_customer_id;

    if (!customerId) {
      // No customer ID found - check by email
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (!userData?.user?.email) {
        return res.status(400).json({ error: 'User not found' });
      }

      // Search for customer by email
      const customers = await stripe.customers.list({
        email: userData.user.email,
        limit: 1,
      });

      if (customers.data.length === 0) {
        return res.status(200).json({ success: false, message: 'No Stripe customer found' });
      }

      // Check for active subscriptions
      const subscriptions = await stripe.subscriptions.list({
        customer: customers.data[0].id,
        status: 'active',
        limit: 1,
      });

      if (subscriptions.data.length > 0) {
        // Found active subscription - update database
        await activateUser(userId, customers.data[0].id, subscriptions.data[0].id);
        return res.status(200).json({ success: true, activated: true });
      }

      // Also check for recent completed checkout sessions
      const sessions = await stripe.checkout.sessions.list({
        customer: customers.data[0].id,
        limit: 5,
      });

      const completedSession = sessions.data.find(s =>
        s.status === 'complete' &&
        s.payment_status === 'paid' &&
        s.mode === 'subscription'
      );

      if (completedSession) {
        await activateUser(userId, customers.data[0].id, completedSession.subscription as string);
        return res.status(200).json({ success: true, activated: true });
      }

      return res.status(200).json({ success: false, message: 'No completed checkout found' });
    }

    // We have a customer ID - check for active subscription
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.data.length > 0) {
      await activateUser(userId, customerId, subscriptions.data[0].id);
      return res.status(200).json({ success: true, activated: true });
    }

    // Check recent checkout sessions
    const sessions = await stripe.checkout.sessions.list({
      customer: customerId,
      limit: 5,
    });

    const completedSession = sessions.data.find(s =>
      s.status === 'complete' &&
      s.payment_status === 'paid' &&
      s.mode === 'subscription'
    );

    if (completedSession) {
      await activateUser(userId, customerId, completedSession.subscription as string);
      return res.status(200).json({ success: true, activated: true });
    }

    return res.status(200).json({ success: false, message: 'Payment not yet confirmed' });

  } catch (error: any) {
    console.error('Verify checkout error:', error);
    return res.status(500).json({ error: error.message || 'Verification failed' });
  }
}

async function activateUser(userId: string, customerId: string, subscriptionId: string | null) {
  console.log(`🎯 Activating user ${userId} immediately after checkout`);

  // Update user_profiles
  await supabaseAdmin
    .from('user_profiles')
    .upsert({
      user_id: userId,
      has_contesting: true,
      stripe_customer_id: customerId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  // Update autopilot_subscriptions
  await supabaseAdmin
    .from('autopilot_subscriptions')
    .upsert({
      user_id: userId,
      status: 'active',
      stripe_customer_id: customerId,
      stripe_subscription_id: subscriptionId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });

  console.log(`✅ User ${userId} activated successfully`);
}
