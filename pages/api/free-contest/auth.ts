import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const expected = process.env.FREE_CONTEST_PASSWORD;
  if (!expected) {
    return res.status(503).json({ error: 'Preview not configured.' });
  }
  const submitted = typeof req.body?.password === 'string' ? req.body.password : '';
  if (submitted !== expected) {
    return res.status(401).json({ error: 'Wrong password.' });
  }
  return res.status(200).json({ ok: true });
}
