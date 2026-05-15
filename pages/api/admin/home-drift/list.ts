import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAdminAuth } from '../../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Admin endpoint: list unresolved DRIFT_DETECTED signals with user email +
// stated home address joined in. Used by the /admin/home-drift page.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  // Pull the latest unresolved DRIFT_DETECTED signal per user (most recent first).
  const { data: signals, error } = await supabase
    .from('home_address_drift_signals')
    .select(
      'id, user_id, detected_at, status, home_ward, home_section, candidate_ward, candidate_section, candidate_fraction, overnight_event_count, candidate_lat, candidate_lng, user_response, cooldown_until'
    )
    .eq('status', 'DRIFT_DETECTED')
    .is('user_response', null)
    .or(`cooldown_until.is.null,cooldown_until.lte.${new Date().toISOString()}`)
    .order('detected_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: sanitizeErrorMessage(error) });

  // Keep only the newest per user.
  const newestByUser = new Map<string, any>();
  for (const s of signals || []) {
    if (!newestByUser.has(s.user_id)) newestByUser.set(s.user_id, s);
  }
  const latest = [...newestByUser.values()];

  // Join in user email + home_address_full.
  const userIds = latest.map((r) => r.user_id);
  const emailMap: Record<string, string | null> = {};
  for (const id of userIds) {
    const { data } = await supabase.auth.admin.getUserById(id);
    emailMap[id] = data?.user?.email ?? null;
  }
  const { data: profiles } = await supabase
    .from('user_profiles')
    .select('user_id, home_address_full')
    .in('user_id', userIds);
  const homeMap: Record<string, string | null> = {};
  for (const p of profiles || []) homeMap[(p as any).user_id] = (p as any).home_address_full ?? null;

  const rows = latest.map((r) => ({
    ...r,
    user_email: emailMap[r.user_id] ?? null,
    home_address_full: homeMap[r.user_id] ?? null,
  }));

  return res.status(200).json({ rows, count: rows.length });
}
