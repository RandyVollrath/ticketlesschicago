/**
 * Stripe Connect OAuth Callback
 * Handles successful Stripe account connection
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { code, state } = req.query;

  if (!code) {
    return res.redirect('/remitter-portal?error=authorization_failed');
  }

  try {
    // Exchange code for account ID
    const response = await stripe.oauth.token({
      grant_type: 'authorization_code',
      code: code as string,
    });

    const connectedAccountId = response.stripe_user_id;

    // Get account details
    const account = await stripe.accounts.retrieve(connectedAccountId);

    // Update partner record
    await supabase
      .from('renewal_partners')
      .update({
        stripe_connected_account_id: connectedAccountId,
        stripe_account_status: account.charges_enabled ? 'active' : 'pending',
        payout_enabled: account.payouts_enabled,
        onboarding_completed: account.charges_enabled && account.payouts_enabled,
      })
      .eq('stripe_connected_account_id', connectedAccountId);

    // Redirect to portal
    return res.redirect('/remitter-portal?setup=complete');

  } catch (error: any) {
    console.error('OAuth callback error:', error);
    return res.redirect('/remitter-portal?error=connection_failed');
  }
}
