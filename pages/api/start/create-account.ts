import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Allow', ['POST']);

  return res.status(410).json({
    error: 'Pre-payment account creation has been disabled. Start checkout from the paid funnel instead.',
  });
}
