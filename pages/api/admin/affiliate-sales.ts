import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { supabase } from '../../../lib/supabase';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia'
});

const ADMIN_EMAILS = ['randyvollrath@gmail.com', 'carenvollrath@gmail.com'];

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check auth
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user || !ADMIN_EMAILS.includes(user.email || '')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // Fetch recent checkout sessions with affiliate referrals (last 30 days)
    const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);

    const sessions = await stripe.checkout.sessions.list({
      created: { gte: thirtyDaysAgo },
      limit: 100,
    });

    // Filter for sessions with client_reference_id (Rewardful referral) and extract data
    const affiliateSales = sessions.data
      .filter(session => session.client_reference_id && session.status === 'complete')
      .map(session => {
        const plan = session.metadata?.plan || 'unknown';
        const totalAmount = session.amount_total ? session.amount_total / 100 : 0;
        const expectedCommission = plan === 'monthly' ? 2.40 : plan === 'annual' ? 24.00 : 0;

        return {
          id: session.id,
          customer_email: session.customer_details?.email || session.metadata?.email || 'Unknown',
          plan,
          total_amount: totalAmount,
          expected_commission: expectedCommission,
          referral_id: session.client_reference_id,
          created_at: new Date(session.created * 1000).toISOString()
        };
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    return res.status(200).json({ sales: affiliateSales });

  } catch (error: any) {
    console.error('Error fetching affiliate sales:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
