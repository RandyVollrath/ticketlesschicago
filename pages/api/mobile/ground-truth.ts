import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';

type GroundTruthEvent = {
  id?: string;
  type: string;
  timestamp: number;
  driveSessionId?: string | null;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, unknown>;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization token' });
    }
    const accessToken = authHeader.substring(7);

    if (!supabaseAdmin) {
      return res.status(500).json({ error: 'Database not configured' });
    }

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(accessToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid authorization token' });
    }

    const events: GroundTruthEvent[] = Array.isArray(req.body?.events) ? req.body.events : [];
    if (events.length === 0) {
      return res.status(200).json({ success: true, accepted: 0 });
    }

    const rows = events.slice(0, 200).map((event) => ({
      user_id: user.id,
      event_type: event.type,
      event_ts: new Date(event.timestamp || Date.now()).toISOString(),
      drive_session_id: event.driveSessionId || null,
      latitude: typeof event.latitude === 'number' ? event.latitude : null,
      longitude: typeof event.longitude === 'number' ? event.longitude : null,
      metadata: event.metadata || {},
      created_at: new Date().toISOString(),
    }));

    const { error: insertError } = await supabaseAdmin
      .from('mobile_ground_truth_events')
      .insert(rows);

    if (insertError) {
      console.warn('[ground-truth] insert failed', insertError.message);
      // Accept request even if table is not yet migrated, so mobile queue can keep flowing.
      return res.status(200).json({ success: true, accepted: 0, warning: 'insert_failed' });
    }

    return res.status(200).json({ success: true, accepted: rows.length });
  } catch (error: any) {
    console.error('[ground-truth] unexpected error', error);
    return res.status(500).json({ error: error?.message || 'Internal server error' });
  }
}
