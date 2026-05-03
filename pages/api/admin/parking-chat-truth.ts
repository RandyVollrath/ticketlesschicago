import type { NextApiRequest, NextApiResponse } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';
import { supabaseAdmin } from '../../../lib/supabase';

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  const auth = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  let authorized = !!cronSecret && auth === `Bearer ${cronSecret}`;
  let actorEmail: string | null = null;

  if (!authorized) {
    const supabase = createPagesServerClient({ req, res });
    const { data: { session } } = await supabase.auth.getSession();
    actorEmail = session?.user?.email || null;
    authorized = !!actorEmail && ADMIN_EMAILS.includes(actorEmail);
  }

  if (!authorized) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const {
    diagnostic_id,
    confirmed_parking,
    confirmed_block,
    reported_side,
    corrected_address,
    note,
    source,
  } = req.body || {};

  if (!diagnostic_id) {
    return res.status(400).json({ error: 'diagnostic_id is required' });
  }

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from('parking_diagnostics')
    .select('id, user_id, raw_lat, raw_lng, resolved_side, native_meta')
    .eq('id', diagnostic_id)
    .single();

  if (fetchErr || !row) {
    return res.status(404).json({ error: 'parking_diagnostics row not found' });
  }

  const meta = (row.native_meta && typeof row.native_meta === 'object')
    ? row.native_meta as Record<string, any>
    : {};
  const feedbackSource = typeof source === 'string' && source.trim().length > 0
    ? source.trim().slice(0, 80)
    : 'chat_claude';

  const update: Record<string, any> = {
    user_feedback_at: new Date().toISOString(),
    native_meta: {
      ...meta,
      feedback_source: feedbackSource,
      corrected_address: typeof corrected_address === 'string' && corrected_address.trim().length > 0
        ? corrected_address.trim().slice(0, 200)
        : (meta.corrected_address ?? null),
      feedback_note: typeof note === 'string' && note.trim().length > 0
        ? note.trim().slice(0, 500)
        : (meta.feedback_note ?? null),
      feedback_actor_email: actorEmail,
      truth_via: 'chat',
    },
  };

  if (typeof confirmed_parking === 'boolean') {
    update.user_confirmed_parking = confirmed_parking;
  }
  if (typeof confirmed_block === 'boolean') {
    update.user_confirmed_block = confirmed_block;
    update.street_correct = confirmed_block;
  }
  if (typeof reported_side === 'string' && reported_side.trim()) {
    const normalizedSide = reported_side.trim().toUpperCase().slice(0, 1);
    update.user_reported_side = normalizedSide;
    if (row.resolved_side) {
      update.side_correct = normalizedSide === row.resolved_side;
    }
  }

  const { error: updateErr } = await supabaseAdmin
    .from('parking_diagnostics')
    .update(update)
    .eq('id', row.id);

  if (updateErr) {
    return res.status(500).json({ error: 'Failed to update parking_diagnostics', details: updateErr.message });
  }

  if (row.user_id) {
    await supabaseAdmin.from('mobile_ground_truth_events').insert({
      user_id: row.user_id,
      event_type: 'parking_chat_review',
      event_ts: new Date().toISOString(),
      latitude: row.raw_lat,
      longitude: row.raw_lng,
      metadata: {
        diagnostic_id: row.id,
        confirmed_parking: typeof confirmed_parking === 'boolean' ? confirmed_parking : null,
        confirmed_block: typeof confirmed_block === 'boolean' ? confirmed_block : null,
        reported_side: typeof reported_side === 'string' ? reported_side.trim().toUpperCase().slice(0, 1) : null,
        corrected_address: typeof corrected_address === 'string' ? corrected_address.trim().slice(0, 200) : null,
        note: typeof note === 'string' ? note.trim().slice(0, 500) : null,
        source: feedbackSource,
        actor_email: actorEmail,
      },
    });
  }

  return res.status(200).json({ success: true, diagnostic_id: row.id, feedback_source: feedbackSource });
}
