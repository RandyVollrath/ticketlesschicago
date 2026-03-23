import { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Check Admin Status
 *
 * Quick endpoint to verify if current user is admin
 * Useful for debugging authentication issues
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

    const adminEmails = ['randy.vollrath@gmail.com', 'randyvollrath@gmail.com', process.env.ADMIN_EMAIL].filter(Boolean);
    const isAdmin = adminEmails.includes(session.user.email || '');

    // SECURITY: Never expose the admin email list — any authenticated user can call this endpoint.
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
