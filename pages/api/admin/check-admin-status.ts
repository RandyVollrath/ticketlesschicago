import { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { isAdminUser } from '../../../lib/auth-middleware';

/**
 * Check Admin Status
 *
 * Quick endpoint to verify if current user is admin.
 * Delegates to the central isAdminUser helper so the answer matches every
 * other admin check (withAdminAuth, system-health, etc.).
 *
 * GET /api/admin/check-admin-status
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const supabase = createPagesServerClient({ req, res });
    const {
      data: { session }
    } = await supabase.auth.getSession();

    if (!session) {
      return res.status(401).json({
        isAdmin: false,
        isAuthenticated: false,
        message: 'Not authenticated',
        redirectUrl: '/login'
      });
    }

    const isAdmin = await isAdminUser(session.user.id, session.user.email);

    return res.status(200).json({
      isAdmin,
      isAuthenticated: true,
      message: isAdmin
        ? 'You have admin access'
        : 'You do not have admin access',
    });
  } catch (error: any) {
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
