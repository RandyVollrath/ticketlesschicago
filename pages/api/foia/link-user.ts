/**
 * POST /api/foia/link-user
 *
 * Called during auth callback to claim any orphaned foia_history_requests
 * that match the newly-authenticated user's email.
 *
 * When a user submits a FOIA request via /ticket-history before creating
 * an account, the row is inserted with user_id = null.  Once they sign up
 * (OAuth or magic-link), this endpoint back-fills user_id so the request
 * appears on their /settings dashboard.
 *
 * Body: { userId, email }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // SECURITY: Authenticate the request
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ') || !supabase) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.substring(7);
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authUser) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const { userId, email } = req.body;

  if (!userId || typeof userId !== 'string') {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  // SECURITY: Ensure the authenticated user matches the userId in the request
  if (authUser.id !== userId) {
    return res.status(403).json({ error: 'You can only link your own FOIA requests' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    // Find orphaned FOIA history requests (user_id IS NULL) that match this email
    const { data: orphaned, error: fetchError } = await supabaseAdmin
      .from('foia_history_requests')
      .select('id')
      .eq('email', cleanEmail)
      .is('user_id', null);

    if (fetchError) {
      console.error('Error fetching orphaned FOIA requests:', fetchError.message);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!orphaned || orphaned.length === 0) {
      return res.status(200).json({ linked: 0 });
    }

    // Link them to the user
    const ids = orphaned.map((r) => r.id);
    const { error: updateError } = await supabaseAdmin
      .from('foia_history_requests')
      .update({ user_id: userId, updated_at: new Date().toISOString() })
      .in('id', ids);

    if (updateError) {
      console.error('Error linking FOIA requests to user:', updateError.message);
      return res.status(500).json({ error: 'Failed to link requests' });
    }

    console.log(`Linked ${ids.length} orphaned FOIA request(s) to user ${userId} (${cleanEmail})`);

    // Also update user_profiles foia_history_consent if not already set
    const { error: consentError } = await supabaseAdmin
      .from('user_profiles')
      .update({
        foia_history_consent: true,
        foia_history_consent_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .eq('foia_history_consent', false);

    if (consentError) {
      console.error('Failed to update foia_history_consent (non-fatal):', consentError.message);
    }

    return res.status(200).json({ linked: ids.length });
  } catch (err: any) {
    console.error('Exception in foia/link-user:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
