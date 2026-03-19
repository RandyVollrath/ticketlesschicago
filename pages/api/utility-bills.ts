/**
 * Legacy redirect: /api/utility-bills → /api/webhooks/receipt-forwarding
 *
 * This endpoint has been renamed. This file exists only to redirect any
 * existing webhook configurations or cached URLs to the new path.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import handler from './webhooks/receipt-forwarding';

export const config = {
  api: {
    bodyParser: true,
  },
};

export default async function legacyHandler(req: NextApiRequest, res: NextApiResponse) {
  // Forward all requests to the new endpoint
  return handler(req, res);
}
