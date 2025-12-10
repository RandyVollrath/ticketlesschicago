/**
 * Check Stripe connected account status and capabilities
 */

import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { data: partner } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('id', 'd78e9928-613f-4f1d-b63a-cda5cb20eef0')
      .single();

    if (!partner?.stripe_connected_account_id) {
      return res.status(404).json({
        error: 'No Stripe account connected',
        instructions: 'Visit /api/stripe-connect/authorize?partnerId=d78e9928-613f-4f1d-b63a-cda5cb20eef0'
      });
    }

    // Get account details from Stripe
    const account = await stripe.accounts.retrieve(partner.stripe_connected_account_id);

    // Check capabilities
    const capabilities = {
      card_payments: account.capabilities?.card_payments,
      transfers: account.capabilities?.transfers,
      payouts: account.capabilities,
    };

    // Try to enable transfers if not active
    if (account.capabilities?.transfers !== 'active') {
      try {
        await stripe.accounts.update(partner.stripe_connected_account_id, {
          capabilities: {
            transfers: { requested: true },
          },
        });

        return res.status(200).json({
          message: 'Transfers capability requested',
          accountId: account.id,
          status: 'Transfers capability is being enabled. Try test payment again in 30 seconds.',
        });
      } catch (err: any) {
        return res.status(400).json({
          error: sanitizeErrorMessage(err),
          solution: 'Complete onboarding at: /api/stripe-connect/authorize?partnerId=d78e9928-613f-4f1d-b63a-cda5cb20eef0',
        });
      }
    }

    return res.status(200).json({
      success: true,
      accountId: account.id,
      email: account.email,
      type: account.type,
      capabilities,
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      details_submitted: account.details_submitted,
      ready_for_payments: account.capabilities?.transfers === 'active',
      message: account.capabilities?.transfers === 'active'
        ? '✅ Ready! Try /api/stripe-connect/test-payment now'
        : '❌ Not ready. Complete onboarding first.',
    });

  } catch (error: any) {
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
