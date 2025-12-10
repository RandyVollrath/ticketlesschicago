/**
 * Stripe Connect Authorization
 * Redirects remitter to Stripe to create/connect their account
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { partnerId } = req.query;

  if (!partnerId) {
    return res.status(400).json({ error: 'Missing partnerId' });
  }

  try {
    // Get partner
    const { data: partner, error } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('id', partnerId)
      .single();

    if (error || !partner) {
      return res.status(404).json({ error: 'Partner not found' });
    }

    // Create Stripe Express account if doesn't exist
    let accountId = partner.stripe_connected_account_id;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'US',
        email: partner.email,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual', // or 'company' based on partner type
        business_profile: {
          name: partner.name,
          product_description: 'City sticker renewal services',
        },
      });

      accountId = account.id;

      // Save account ID
      await supabase
        .from('renewal_partners')
        .update({ stripe_connected_account_id: accountId })
        .eq('id', partnerId);
    }

    // Create account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.NEXT_PUBLIC_BASE_URL}/api/stripe-connect/authorize?partnerId=${partnerId}`,
      return_url: `${process.env.NEXT_PUBLIC_BASE_URL}/remitter-portal?setup=complete`,
      type: 'account_onboarding',
    });

    // Redirect to Stripe onboarding
    return res.redirect(302, accountLink.url);

  } catch (error: any) {
    console.error('Stripe Connect error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
