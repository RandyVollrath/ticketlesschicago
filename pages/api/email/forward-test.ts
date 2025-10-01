import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Simple test endpoint to verify Cloudflare Worker is calling us
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  console.log('🔔 WEBHOOK HIT!');
  console.log('Method:', req.method);
  console.log('Headers:', req.headers);
  console.log('Body keys:', Object.keys(req.body || {}));
  console.log('Body:', JSON.stringify(req.body, null, 2));

  return res.status(200).json({
    success: true,
    message: 'Webhook received!',
    received: {
      method: req.method,
      bodyKeys: Object.keys(req.body || {}),
      hasText: !!req.body?.text,
      hasHtml: !!req.body?.html,
      from: req.body?.from,
      subject: req.body?.subject
    }
  });
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};
