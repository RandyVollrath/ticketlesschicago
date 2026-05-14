import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabaseAdmin } from '../../../lib/supabase';
import {
  createRewardfulAffiliate,
  getRewardfulAffiliate,
  findAffiliateByEmail,
} from '../../../lib/rewardful-helper';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

// Unauthenticated, but session_id-gated: only the customer who just paid
// has the {CHECKOUT_SESSION_ID} value Stripe placed in their success URL.
// We verify the session is real + paid, then return the affiliate link
// already minted by the Stripe webhook (race fallback: mint on demand).
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sessionId = typeof req.query.session_id === 'string' ? req.query.session_id : '';
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'Missing or invalid session_id' });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.status(402).json({ error: 'Checkout not completed yet' });
    }

    const email = (session.customer_details?.email || session.customer_email || '').toLowerCase().trim();
    if (!email) {
      return res.status(404).json({ error: 'No email on checkout session' });
    }

    const { data: profile } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, affiliate_id')
      .eq('email', email)
      .maybeSingle();

    // Happy path: webhook already minted the affiliate.
    if (profile?.affiliate_id) {
      const affiliate = await getRewardfulAffiliate(profile.affiliate_id);
      const link = affiliate?.links?.[0];
      if (link?.url) {
        return res.status(200).json({
          referral_link: link.url,
          token: link.token,
        });
      }
    }

    // Race fallback: webhook hasn't run yet (or affiliate creation failed).
    // Try lookup-then-create so we don't double-mint on retries.
    let affiliate = await findAffiliateByEmail(email);
    if (!affiliate) {
      affiliate = await createRewardfulAffiliate({
        email,
        first_name: profile?.first_name || email.split('@')[0],
        last_name: profile?.last_name || 'Member',
        campaign_id: process.env.REWARDFUL_CUSTOMER_CAMPAIGN_ID,
        stripe_customer_id: (session.customer as string) || undefined,
      });
    }

    if (!affiliate) {
      return res.status(503).json({ error: 'Referral link not available yet, try again in a moment' });
    }

    // Persist back to profile if we have one.
    if (profile?.user_id && !profile.affiliate_id) {
      await supabaseAdmin
        .from('user_profiles')
        .update({
          affiliate_id: affiliate.id,
          affiliate_signup_date: new Date().toISOString(),
        })
        .eq('user_id', profile.user_id);
    }

    const link = affiliate.links?.[0];
    return res.status(200).json({
      referral_link: link?.url || `https://autopilotamerica.com?via=${link?.token || affiliate.token}`,
      token: link?.token || affiliate.token,
    });
  } catch (error: any) {
    console.error('post-checkout/referral-link error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
