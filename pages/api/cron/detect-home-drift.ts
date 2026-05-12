import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { computeDriftForUser, DRIFT_THRESHOLDS, type DriftStatus } from '../../../lib/home-address-drift';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Daily cron: for each paid user with a stated home_address_section, compare
// to where they've actually been parking overnight (last 14 days). Insert a
// signal row per user. Internal/admin-only — no user notifications.
//
// Schedule: 09:00 UTC daily (runs after update-user-zones at 08:00 UTC so home
// section reflects any zone redraws).
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startedAt = Date.now();
  const summary: Record<DriftStatus, number> & { errors: number; skipped_cooldown: number } = {
    INSUFFICIENT_DATA: 0,
    STILL_AT_HOME: 0,
    CONFIRMED_HOME: 0,
    DRIFT_DETECTED: 0,
    AMBIGUOUS: 0,
    errors: 0,
    skipped_cooldown: 0,
  };
  const drifts: Array<{ user_id: string; home: string; candidate: string; fraction: number }> = [];

  try {
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('user_id, home_address_ward, home_address_section')
      .eq('is_paid', true)
      .not('home_address_section', 'is', null)
      .neq('home_address_section', '');
    if (error) throw new Error(`user_profiles fetch: ${error.message}`);

    const nowIso = new Date().toISOString();

    for (const u of users || []) {
      const userId = (u as any).user_id as string;
      try {
        // Skip if a still-active cooldown row exists.
        const { data: cooldownRows, error: cooldownErr } = await supabase
          .from('home_address_drift_signals')
          .select('id, cooldown_until')
          .eq('user_id', userId)
          .gt('cooldown_until', nowIso)
          .limit(1);
        if (cooldownErr) throw new Error(`cooldown query: ${cooldownErr.message}`);
        if (cooldownRows && cooldownRows.length > 0) {
          summary.skipped_cooldown++;
          continue;
        }

        const result = await computeDriftForUser(supabase, userId);

        const { error: insertErr } = await supabase.from('home_address_drift_signals').insert({
          user_id: userId,
          status: result.status,
          home_ward: result.home_ward,
          home_section: result.home_section,
          candidate_ward: result.candidate_ward,
          candidate_section: result.candidate_section,
          candidate_fraction: result.candidate_fraction,
          home_fraction: result.home_fraction,
          overnight_event_count: result.overnight_event_count,
          window_days: result.window_days,
        });
        if (insertErr) throw new Error(`signal insert: ${insertErr.message}`);

        // Increment counters only after the row landed — otherwise insert
        // failures would silently inflate the status counts.
        summary[result.status]++;

        if (result.status === 'DRIFT_DETECTED') {
          drifts.push({
            user_id: userId,
            home: `W${result.home_ward} S${result.home_section}`,
            candidate: `W${result.candidate_ward} S${result.candidate_section}`,
            fraction: result.candidate_fraction ?? 0,
          });
        }
      } catch (e: any) {
        summary.errors++;
        console.error(`detect-home-drift user ${userId} error:`, e?.message || e);
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `detect-home-drift: checked ${users?.length ?? 0} users in ${elapsedMs}ms`,
      JSON.stringify(summary),
      drifts.length ? `drifts=${JSON.stringify(drifts)}` : ''
    );

    return res.status(200).json({
      checked: users?.length ?? 0,
      elapsed_ms: elapsedMs,
      thresholds: DRIFT_THRESHOLDS,
      summary,
      drifts,
    });
  } catch (e: any) {
    console.error('detect-home-drift fatal:', e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
