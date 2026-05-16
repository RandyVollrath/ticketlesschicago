/**
 * POST /api/admin/update-permit-target
 * Body: { id, status, notes? }
 * Updates one priority-target row.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { permitSb } from '../../../lib/permit-zone-supabase';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { id, status, notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  const patch: any = {};
  if (status) patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  if (status === 'done') patch.collected_at = new Date().toISOString();
  const { error } = await (permitSb as any)
    .from('permit_zone_collection_targets')
    .update(patch)
    .eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
