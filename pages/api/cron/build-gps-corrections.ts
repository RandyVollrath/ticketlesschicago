/**
 * Cron endpoint: refresh the GPS bias-grid correction model.
 *
 * Calls two SQL aggregators:
 *   1. refresh_block_centroids_from_meters() — sets block_centroid_lat/lng
 *      from averaged active-meter positions per 100-block.
 *   2. refresh_block_offsets_from_diagnostics() — for every metered block
 *      with ≥3 confident-snap parking events, sets offset_lat/lng to the
 *      mean (block_centroid - raw_gps), so check-parking can shift future
 *      GPS fixes toward the block's true position before snap-to-street.
 *
 * Safe to re-run; converges as more events accumulate.
 *
 * Schedule: daily at 09:30 UTC (4:30am Chicago — quiet hour).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const auth = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? auth === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const startedAt = Date.now();

  const { data: centroidTouched, error: centroidErr } = await sb.rpc('refresh_block_centroids_from_meters');
  if (centroidErr) {
    console.error('[cron build-gps-corrections] centroid refresh failed:', centroidErr);
    return res.status(500).json({ ok: false, stage: 'centroid', error: centroidErr.message });
  }

  const { data: offsetTouched, error: offsetErr } = await sb.rpc('refresh_block_offsets_from_diagnostics', {
    p_min_events: 3,
    p_max_snap_distance_m: 25,
  });
  if (offsetErr) {
    console.error('[cron build-gps-corrections] offset refresh failed:', offsetErr);
    return res.status(500).json({ ok: false, stage: 'offset', error: offsetErr.message });
  }

  const { count: nonzero } = await sb
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true })
    .or('offset_lat.neq.0,offset_lng.neq.0');

  const { count: total } = await sb
    .from('gps_block_corrections')
    .select('*', { count: 'exact', head: true });

  const elapsedMs = Date.now() - startedAt;
  console.log(`[cron build-gps-corrections] centroids touched=${centroidTouched}, offsets updated=${offsetTouched}, total blocks=${total}, with offset=${nonzero}, took ${elapsedMs}ms`);

  return res.status(200).json({
    ok: true,
    centroids_touched: centroidTouched,
    offsets_updated: offsetTouched,
    total_blocks: total,
    blocks_with_offset: nonzero,
    elapsed_ms: elapsedMs,
  });
}
