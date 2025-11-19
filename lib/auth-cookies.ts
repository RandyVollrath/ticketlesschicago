import { NextApiResponse } from 'next';
import { serialize, parse } from 'cookie';

const REDIRECT_COOKIE_NAME = 'auth_redirect';
const MAX_AGE = 10 * 60; // 10 minutes

/**
 * Set HTTP-only cookie with redirect destination before OAuth flow
 * This cookie survives the OAuth redirect through external provider
 */
export function setRedirectCookie(res: NextApiResponse, redirectPath: string) {
  const cookie = serialize(REDIRECT_COOKIE_NAME, redirectPath, {
    httpOnly: true, // Prevents XSS attacks
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    sameSite: 'lax', // CRITICAL: allows cookie to survive OAuth redirect while preventing CSRF
    maxAge: MAX_AGE, // Auto-expire after 10 minutes
    path: '/' // Available on all paths
  });

  res.setHeader('Set-Cookie', cookie);
  console.log('🍪 Set auth redirect cookie:', redirectPath);
}

/**
 * Read redirect destination from cookie header
 */
export function getRedirectCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const cookies = parse(cookieHeader);
  const redirect = cookies[REDIRECT_COOKIE_NAME] || null;

  if (redirect) {
    console.log('🍪 Found redirect in cookie:', redirect);
  }

  return redirect;
}

/**
 * Clear redirect cookie after successful redirect
 */
export function clearRedirectCookie(res: NextApiResponse) {
  const cookie = serialize(REDIRECT_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 0, // Expire immediately
    path: '/'
  });

  res.setHeader('Set-Cookie', cookie);
  console.log('🍪 Cleared auth redirect cookie');
}
