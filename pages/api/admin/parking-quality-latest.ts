/**
 * Read-only admin endpoint: latest parking-quality report + fresh diagnose snapshot.
 *
 * Consumed by the auto-improver routine. Returns BOTH:
 *   - the most recent persisted parking_quality_reports row (rolled metrics)
 *   - a fresh diagnose(hours) call so the agent has top_signatures with
 *     example rows to inspect (what the improver skill needs)
 *
 *   GET /api/admin/parking-quality-latest?hours=24
 *   Authorization: Bearer <CRON_SECRET>
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { diagnose } from '../../../lib/parking-quality-diagnose';

export const config = { maxDuration: 60 };

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const hours = Math.max(1, Math.min(168, Number(req.query.hours) || 24));

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: latestReport, error: reportErr } = await sb
    .from('parking_quality_reports')
    .select('*')
    .order('window_end', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reportErr) {
    return res.status(500).json({ error: 'parking_quality_reports query failed', details: reportErr.message });
  }

  let fresh;
  try {
    fresh = await diagnose(hours);
  } catch (e: any) {
    return res.status(500).json({ error: 'diagnose() failed', details: e?.message || String(e) });
  }

  return res.status(200).json({
    hours,
    latest_persisted_report: latestReport,
    fresh_diagnosis: {
      window_start: fresh.window_start,
      window_end: fresh.window_end,
      total_rows: fresh.total_rows,
      total_users: fresh.total_users,
      overall_failure_counts: fresh.overall_failure_counts,
      truth_metrics: fresh.truth_metrics,
      top_signatures: fresh.top_signatures,
      prior_reports: fresh.prior_reports,
    },
  });
}
