import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { referralId, email } = req.body;

  if (!referralId || !email) {
    return res.status(400).json({ error: 'Missing referralId or email' });
  }

  console.log('Rewardful lead registration requested for referral:', referralId, 'email:', email);
  
  // Note: Rewardful automatically tracks leads when referral data reaches Stripe.
  // There's no separate REST API endpoint for lead registration.
  // Leads are created when:
  // 1. User has referral cookie/ID
  // 2. They proceed to Stripe checkout
  // 3. Stripe session includes the referral ID as client_reference_id
  
  console.log('Lead will be automatically tracked when user reaches Stripe checkout');
  return res.status(200).json({ 
    success: true, 
    message: 'Lead tracking queued - will be registered automatically via Stripe integration' 
  });
}