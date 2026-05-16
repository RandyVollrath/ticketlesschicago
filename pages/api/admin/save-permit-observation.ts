/**
 * POST /api/admin/save-permit-observation
 * Body: JSON observation object (matches permit_zone_field_observations columns).
 * Optional fields: photo_base64 (data:image/jpeg;base64,…) — uploaded to Supabase Storage.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { permitSb } from '../../../lib/permit-zone-supabase';

export const config = { api: { bodyParser: { sizeLimit: '15mb' } } };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const obs = req.body || {};

  // Optional photo upload
  let photo_url: string | null = null;
  if (obs.photo_base64 && typeof obs.photo_base64 === 'string') {
    const m = obs.photo_base64.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (m) {
      const mime = m[1];
      const ext = mime.split('/')[1];
      const buf = Buffer.from(m[2], 'base64');
      const key = `permit-signs/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await permitSb.storage.from('permit-sign-photos').upload(key, buf, {
        contentType: mime,
        upsert: false,
      });
      if (upErr && !upErr.message?.includes('already exists')) {
        return res.status(500).json({ error: 'photo upload failed: ' + upErr.message });
      }
      const { data: pub } = permitSb.storage.from('permit-sign-photos').getPublicUrl(key);
      photo_url = pub?.publicUrl || null;
    }
  }
  delete obs.photo_base64;

  // Cross-validate zone
  if (obs.zone_on_sign != null && obs.matched_zone != null) {
    obs.zone_matches = Number(obs.zone_on_sign) === Number(obs.matched_zone);
  }
  if (photo_url) obs.photo_url = photo_url;

  // Strip any unknown columns (defense against client tampering)
  const ALLOWED = new Set([
    'collected_by', 'collected_at',
    'lat', 'lon', 'gps_accuracy_m',
    'segment_row_id', 'matched_zone',
    'street_direction', 'street_name', 'street_type', 'block_low', 'block_high', 'odd_even',
    'zone_on_sign',
    'days_mon', 'days_tue', 'days_wed', 'days_thu', 'days_fri', 'days_sat', 'days_sun', 'all_days',
    'hours_start', 'hours_end', 'all_times',
    'sign_condition', 'raw_sign_text', 'notes', 'photo_url',
    'zone_matches',
  ]);
  const row: any = {};
  for (const k of Object.keys(obs)) if (ALLOWED.has(k)) row[k] = obs[k];

  const { data, error } = await (permitSb as any)
    .from('permit_zone_field_observations')
    .insert(row)
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ id: (data as { id: string }).id, photo_url });
}
