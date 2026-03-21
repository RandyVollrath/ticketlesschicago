/**
 * Web-facing endpoint: Submit a permit zone hours correction.
 *
 * Unlike /api/mobile/report-zone-hours (which requires Bearer auth and handles photos),
 * this endpoint accepts simple text corrections from the settings page.
 * All submissions go to pending_review for admin approval.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth via session cookie or Bearer token
  let userId: string | null = null;

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const { data: { user } } = await supabaseAdmin.auth.getUser(authHeader.substring(7));
    if (user) userId = user.id;
  }

  if (!userId) {
    try {
      const supabaseServer = createPagesServerClient({ req, res });
      const { data: { session } } = await supabaseServer.auth.getSession();
      if (session?.user) userId = session.user.id;
    } catch {}
  }

  if (!userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { zone, correctedSchedule, currentSchedule, address } = req.body || {};

  if (!zone || !correctedSchedule) {
    return res.status(400).json({ error: 'zone and correctedSchedule are required' });
  }

  // Rate limit: max 10 per day
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('permit_zone_user_reports')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', twentyFourHoursAgo);

  if ((count ?? 0) >= 10) {
    return res.status(429).json({ error: 'Too many corrections today. Try again tomorrow.' });
  }

  // Insert report — always pending_review for text-only corrections
  const { error } = await supabaseAdmin
    .from('permit_zone_user_reports')
    .insert({
      user_id: userId,
      zone,
      zone_type: 'residential',
      address: address || null,
      reported_schedule: correctedSchedule,
      current_schedule: currentSchedule || null,
      status: 'pending_review',
    });

  if (error) {
    console.error('Failed to insert zone correction:', error.message);
    return res.status(500).json({ error: 'Failed to save correction' });
  }

  return res.status(200).json({
    success: true,
    message: 'Thanks for the correction! Our team will review and update the hours.',
  });
}
