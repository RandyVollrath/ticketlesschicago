import { NextApiRequest, NextApiResponse } from 'next';

/**
 * Simple test endpoint to verify Cloudflare Worker is calling us
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // SECURITY: Only allow in development mode
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }

  console.log('🔔 WEBHOOK HIT!');
  console.log('Method:', req.method);
  // SECURITY: Don't log full headers
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Body keys:', Object.keys(req.body || {}));

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
