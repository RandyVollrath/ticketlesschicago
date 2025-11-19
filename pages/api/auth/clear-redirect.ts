import { NextApiRequest, NextApiResponse } from 'next';
import { clearRedirectCookie } from '../../../lib/auth-cookies';

/**
 * Clear Redirect Cookie After Successful Redirect
 *
 * Called by callback page AFTER successfully redirecting user
 * Removes the cookie to prevent reuse
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow both GET and POST for easier debugging
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    clearRedirectCookie(res);

    return res.status(200).json({
      success: true,
      message: 'Redirect cookie cleared successfully'
    });
  } catch (error: any) {
    console.error('Error clearing cookie:', error);
    return res.status(500).json({
      error: 'Failed to clear cookie',
      message: error.message
    });
  }
}
