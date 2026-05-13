// Daily cron: mark pending consents whose expires_at has passed as 'expired'.
// Without this, the dedup logic in create-authorized-renewal-consents.ts
// (which counts pending/granted/consumed in the last 60 days) would block
// new authorize emails for a user who ignored the first one — for the full
// 60-day lookback window.

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin as typedSupabase } from '../../../lib/supabase';

const supabaseAdmin = typedSupabase as any;

function isAuthorizedCron(req: NextApiRequest): boolean {
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'unauthorized' });

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('renewal_purchase_consents')
    .update({ status: 'expired', updated_at: now })
    .eq('status', 'pending')
    .lt('expires_at', now)
    .select('id');

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true, expired: data?.length ?? 0 });
}
