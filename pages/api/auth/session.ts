import { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Session Sync Endpoint
 *
 * Called by auth callback to ensure server-side session cookie is set
 * This is necessary because the implicit flow stores sessions in localStorage
 * which isn't accessible to server-side code
 *
 * POST /api/auth/session
 * Authorization: Bearer <access_token>
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get tokens from request body
    const { access_token, refresh_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: 'Missing access_token in request body' });
    }

    // Create server client - this will manage session cookies
    const supabase = createPagesServerClient({ req, res });

    // Set the session on the server side - this is the key step
    // This will create the proper HTTP-only cookies that server-side code can read
    const { data, error } = await supabase.auth.setSession({
      access_token,
      refresh_token: refresh_token || ''
    });

    if (error || !data.session) {
      console.error('❌ Failed to set server session:', error);
      return res.status(401).json({ error: 'Failed to set server session' });
    }

    console.log('✅ Server-side session established for:', data.session.user.email);

    return res.status(200).json({
      success: true,
      userId: data.session.user.id,
      email: data.session.user.email,
      message: 'Server-side session established'
    });
  } catch (error: any) {
    console.error('❌ Error establishing server session:', error);
    return res.status(500).json({
      error: sanitizeErrorMessage(error)
    });
  }
}
