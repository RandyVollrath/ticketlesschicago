/**
 * Test endpoint to verify Stripe Connect environment variables
 */

import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  return res.status(200).json({
    environment: process.env.NODE_ENV,
    hasClientId: !!clientId,
    clientIdPrefix: clientId ? clientId.substring(0, 8) + '...' : 'MISSING',
    hasBaseUrl: !!baseUrl,
    baseUrl: baseUrl || 'MISSING',
    hasStripeKey: !!stripeKey,
    stripeKeyPrefix: stripeKey ? stripeKey.substring(0, 8) + '...' : 'MISSING',
    allReady: !!(clientId && baseUrl && stripeKey),
  });
}
