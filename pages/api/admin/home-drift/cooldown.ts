import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAdminAuth } from '../../../../lib/auth-middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Admin endpoint: mark a drift signal as dismissed and set a cooldown so the
// daily cron doesn't re-flag the same user until the cooldown expires.
//
// POST body: { signal_id: string, days?: number, response?: 'moved'|'visiting'|'manual_update'|'dismissed', reason?: string }
//
// Default cooldown: 30 days. Default response: 'dismissed'.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const admin = await requireAdminAuth(req, res);
  if (!admin) return; // requireAdminAuth already responded

  const { signal_id, days, response, reason } = req.body || {};
  if (!signal_id || typeof signal_id !== 'string') {
    return res.status(400).json({ error: 'signal_id required' });
  }
  const cooldownDays = typeof days === 'number' && days > 0 && days <= 365 ? days : 30;
  const userResponse =
    typeof response === 'string' && ['moved', 'visiting', 'manual_update', 'dismissed'].includes(response)
      ? response
      : 'dismissed';

  const cooldownUntil = new Date(Date.now() + cooldownDays * 86400_000).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from('home_address_drift_signals')
    .update({
      cooldown_until: cooldownUntil,
      user_response: userResponse,
      responded_at: now,
    })
    .eq('id', signal_id)
    .select('id, user_id, status, cooldown_until, user_response')
    .maybeSingle();

  if (error) {
    console.error(`/admin/home-drift/cooldown error for signal ${signal_id}:`, error.message);
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    return res.status(404).json({ error: 'signal_id not found' });
  }

  console.log(
    `admin/home-drift/cooldown: admin=${admin.email} signal=${signal_id} response=${userResponse} days=${cooldownDays} reason=${reason || '(none)'}`
  );

  return res.status(200).json({ ok: true, signal: data, cooldown_days: cooldownDays });
}
