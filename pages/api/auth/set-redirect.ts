import { NextApiRequest, NextApiResponse } from 'next';
import { setRedirectCookie } from '../../../lib/auth-cookies';

/**
 * Set Redirect Cookie Before OAuth
 *
 * Called by login page BEFORE initiating OAuth or magic link flow
 * Sets HTTP-only cookie that survives OAuth redirect through external provider
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { redirect } = req.body;

  if (!redirect || typeof redirect !== 'string') {
    return res.status(400).json({ error: 'Redirect path required' });
  }

  // Security: Validate redirect path to prevent open redirects.
  // Must start with exactly one slash. Protocol-relative URLs like "//evil.com"
  // start with "/" but redirect to an external domain.
  if (!redirect.startsWith('/') || redirect.startsWith('//')) {
    console.error('⚠️ Invalid redirect attempt (open redirect blocked):', redirect);
    return res.status(400).json({ error: 'Invalid redirect path - must be a relative path' });
  }

  // Optional: Whitelist specific paths for extra security
  const allowedPaths = [
    '/admin',
    '/notification-preferences',
    '/settings',
    '/profile',
    '/my-contests',
    '/contest-ticket',
    '/submit-ticket',
    '/protection',
    '/attorney-dashboard',
    '/remitter-portal'
  ];

  const isAllowed = allowedPaths.some(path => redirect.startsWith(path));
  if (!isAllowed) {
    console.warn('⚠️ Blocked redirect to non-whitelisted path:', redirect);
    return res.status(400).json({ error: 'Redirect path not allowed' });
  }

  // Set HTTP-only cookie with redirect destination
  setRedirectCookie(res, redirect);

  return res.status(200).json({
    success: true,
    redirect,
    message: 'Redirect cookie set successfully'
  });
}
