/**
 * GET /api/admin/permit-collection-targets?status=pending&limit=50
 * Returns priority blocks for the collection workflow.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!supabaseAdmin) return res.status(500).json({ error: 'no service role configured' });
  const status = String(req.query.status || 'pending');
  const limit = Math.min(Number(req.query.limit || 50), 500);
  const sb = supabaseAdmin as any;
  const { data, error } = await sb
    .from('permit_zone_collection_targets')
    .select('*')
    .eq('status', status)
    .order('rank', { ascending: true })
    .limit(limit);
  if (error) return res.status(500).json({ error: error.message });

  // Also fetch summary counts
  const { data: counts } = await sb
    .from('permit_zone_collection_targets')
    .select('status');
  const summary: Record<string, number> = { pending: 0, in_progress: 0, done: 0, skip: 0 };
  for (const r of (counts || []) as Array<{ status: string }>) summary[r.status] = (summary[r.status] || 0) + 1;

  return res.status(200).json({ targets: data, summary });
}
