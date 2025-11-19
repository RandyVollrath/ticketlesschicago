import { NextApiRequest, NextApiResponse } from 'next';
import { clearRedirectCookie } from '../../../lib/auth-cookies';

/**
 * Clear Redirect Cookie After Successful Redirect
 *
 * Called by callback page AFTER successfully redirecting user
 * Removes the cookie to prevent reuse
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  clearRedirectCookie(res);

  return res.status(200).json({
    success: true,
    message: 'Redirect cookie cleared successfully'
  });
}
