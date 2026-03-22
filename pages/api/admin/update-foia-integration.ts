import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * Admin API to update FOIA integration status on a contest letter.
 *
 * POST /api/admin/update-foia-integration
 * Body: { letter_id, cdot_foia_integrated?, finance_foia_integrated?, cdot_foia_notes?, finance_foia_notes? }
 * Auth: CRON_SECRET or admin session
 */

const ADMIN_EMAILS = [
  'randyvollrath@gmail.com',
  'hiautopilotamerica@gmail.com',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not available' });
  }

  // Auth: admin session via cookie OR CRON_SECRET
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isCronAuth = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  let isAdminUser = false;
  if (!isCronAuth) {
    // Check if the request has a valid admin session
    const authCookie = req.cookies['sb-dzhqolbhuqdcpngdayuq-auth-token'];
    if (authCookie) {
      try {
        const parsed = JSON.parse(authCookie);
        const { data } = await supabaseAdmin.auth.getUser(parsed?.access_token || parsed?.[0]);
        if (data?.user?.email && ADMIN_EMAILS.includes(data.user.email)) {
          isAdminUser = true;
        }
      } catch {}
    }

    // Also check Authorization Bearer token
    if (!isAdminUser && authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data } = await supabaseAdmin.auth.getUser(token);
      if (data?.user?.email && ADMIN_EMAILS.includes(data.user.email)) {
        isAdminUser = true;
      }
    }
  }

  if (!isCronAuth && !isAdminUser) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { letter_id, cdot_foia_integrated, finance_foia_integrated, cdot_foia_notes, finance_foia_notes } = req.body;

  if (!letter_id) {
    return res.status(400).json({ error: 'letter_id is required' });
  }

  const update: Record<string, any> = {};

  if (cdot_foia_integrated !== undefined) {
    update.cdot_foia_integrated = cdot_foia_integrated;
    if (cdot_foia_integrated) {
      update.cdot_foia_integrated_at = new Date().toISOString();
    }
  }

  if (finance_foia_integrated !== undefined) {
    update.finance_foia_integrated = finance_foia_integrated;
    if (finance_foia_integrated) {
      update.finance_foia_integrated_at = new Date().toISOString();
    }
  }

  if (cdot_foia_notes !== undefined) {
    update.cdot_foia_notes = cdot_foia_notes;
  }

  if (finance_foia_notes !== undefined) {
    update.finance_foia_notes = finance_foia_notes;
  }

  if (Object.keys(update).length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  const { error } = await supabaseAdmin
    .from('contest_letters')
    .update(update)
    .eq('id', letter_id);

  if (error) {
    console.error('Error updating FOIA integration:', error);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ success: true, updated: update });
}
