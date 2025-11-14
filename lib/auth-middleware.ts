/**
 * Authentication Middleware
 *
 * Provides reusable authentication checks for API endpoints
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

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
