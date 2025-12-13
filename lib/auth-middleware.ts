/**
 * Authentication Middleware
 *
 * Provides reusable authentication checks for API endpoints
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface AuthenticatedUser {
  id: string;
  email?: string;
  isAdmin?: boolean;
}

/**
 * Require authentication - throws if not authenticated
 */
export async function requireAuth(req: NextApiRequest): Promise<AuthenticatedUser> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No authorization header');
  }

  const token = authHeader.substring(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return {
    id: user.id,
    email: user.email,
  };
}

/**
 * Require admin access - throws if not admin
 */
export async function requireAdmin(req: NextApiRequest): Promise<AuthenticatedUser> {
  const user = await requireAuth(req);

  const { data: profile, error } = await supabase
    .from('user_profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .single();

  if (error || !profile?.is_admin) {
    throw new Error('Admin access required');
  }

  return {
    ...user,
    isAdmin: true,
  };
}

/**
 * Verify user owns the resource
 */
export async function verifyOwnership(
  req: NextApiRequest,
  resourceUserId: string
): Promise<AuthenticatedUser> {
  const user = await requireAuth(req);

  if (user.id !== resourceUserId) {
    // Check if admin
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('is_admin')
      .eq('user_id', user.id)
      .single();

    if (!profile?.is_admin) {
      throw new Error('Forbidden - not authorized to access this resource');
    }
  }

  return user;
}

/**
 * Helper to handle auth errors
 */
export function handleAuthError(res: NextApiResponse, error: Error) {
  if (error.message === 'No authorization header' || error.message === 'Invalid or expired token') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (error.message === 'Admin access required' || error.message.includes('Forbidden')) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  return res.status(500).json({ error: 'Internal server error' });
}

/**
 * Admin emails that have access to admin routes
 * Also checks is_admin field in user_profiles
 */
const ADMIN_EMAILS = [
  'randy.vollrath@gmail.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
  process.env.ADMIN_EMAIL,
].filter(Boolean) as string[];

/**
 * Higher-order function to wrap admin API routes with authentication
 * Uses session cookies for browser-based access
 *
 * Usage:
 * ```
 * export default withAdminAuth(async (req, res, user) => {
 *   // Handler code - user is guaranteed to be an admin
 * });
 * ```
 */
export function withAdminAuth(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
    user: { id: string; email: string }
  ) => Promise<void | NextApiResponse>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // Create Supabase client with cookie-based session
      const supabaseServer = createPagesServerClient({ req, res });

      // Get session from cookies
      const { data: { session }, error: sessionError } = await supabaseServer.auth.getSession();

      if (sessionError || !session) {
        console.warn('Admin route accessed without authentication');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const userEmail = session.user.email || '';
      const userId = session.user.id;

      // Check if user is admin by email
      let isAdmin = ADMIN_EMAILS.includes(userEmail);

      // If not in email list, check is_admin field in user_profiles
      if (!isAdmin) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_admin')
          .eq('user_id', userId)
          .single();

        isAdmin = profile?.is_admin === true;
      }

      if (!isAdmin) {
        console.warn(`Non-admin user ${userEmail} attempted to access admin route: ${req.url}`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin access required'
        });
      }

      // User is authenticated and is an admin - call the handler
      return handler(req, res, { id: userId, email: userEmail });

    } catch (error: any) {
      console.error('Admin auth middleware error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Authentication check failed'
      });
    }
  };
}

/**
 * Higher-order function to wrap API routes that can be called by either:
 * 1. Cron jobs with CRON_SECRET in Authorization header
 * 2. Admin users via browser session
 *
 * Usage:
 * ```
 * export default withCronOrAdminAuth(async (req, res, context) => {
 *   // Handler code - caller is guaranteed to be cron or admin
 *   console.log(context.isCron ? 'Called by cron' : `Called by ${context.user?.email}`);
 * });
 * ```
 */
export function withCronOrAdminAuth(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
    context: { isCron: boolean; user?: { id: string; email: string } }
  ) => Promise<void | NextApiResponse>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    try {
      // First check for cron secret in Authorization header
      const authHeader = req.headers.authorization;
      const cronSecret = process.env.CRON_SECRET || 'dev-secret';

      if (authHeader === `Bearer ${cronSecret}`) {
        // Valid cron call
        return handler(req, res, { isCron: true });
      }

      // Not cron - check for admin session
      const supabaseServer = createPagesServerClient({ req, res });
      const { data: { session }, error: sessionError } = await supabaseServer.auth.getSession();

      if (sessionError || !session) {
        console.warn('Protected route accessed without valid cron secret or authentication');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Valid cron secret or admin authentication required'
        });
      }

      const userEmail = session.user.email || '';
      const userId = session.user.id;

      // Check if user is admin
      let isAdmin = ADMIN_EMAILS.includes(userEmail);

      if (!isAdmin) {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('is_admin')
          .eq('user_id', userId)
          .single();

        isAdmin = profile?.is_admin === true;
      }

      if (!isAdmin) {
        console.warn(`Non-admin user ${userEmail} attempted to access protected route: ${req.url}`);
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Admin access required'
        });
      }

      // User is authenticated and is an admin
      return handler(req, res, { isCron: false, user: { id: userId, email: userEmail } });

    } catch (error: any) {
      console.error('Cron/Admin auth middleware error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Authentication check failed'
      });
    }
  };
}
