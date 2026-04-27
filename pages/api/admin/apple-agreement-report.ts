/**
 * Read-only admin endpoint: Apple CLGeocoder agreement stats.
 *
 * Used by the scheduled remote agent on 2026-05-10 to decide whether to
 * promote Apple's geocode vote from "logged for measurement" to "actual
 * tiebreaker in disambiguation." Auth: Bearer CRON_SECRET (same as crons).
 *
 *   GET /api/admin/apple-agreement-report?days=14
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Returns counts, rates, and a recommendation string.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const auth = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: rows, error } = await sb
    .from('parking_diagnostics')
    .select('id, created_at, native_meta, resolved_street_name, user_confirmed_block, user_reported_side, street_correct')
    .gte('created_at', since)
    .not('native_meta', 'is', null);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const withApple = (rows ?? []).filter((r) => r.native_meta?.apple);
  const total = withApple.length;
  let agreed = 0;
  let disagreed = 0;
  let withFeedback = 0;
  let appleRightOnDisagree = 0;
  let appleWrongOnDisagree = 0;
  const disagreementSamples: Array<{ id: number; apple_street: string | null; resolved_street: string | null; created_at: string }> = [];

  for (const r of withApple) {
    const apple = r.native_meta.apple;
    if (apple.agreed_with_resolved === true) {
      agreed++;
    } else if (apple.agreed_with_resolved === false) {
      disagreed++;
      if (disagreementSamples.length < 20) {
        disagreementSamples.push({
          id: r.id,
          apple_street: apple.thoroughfare ?? apple.name ?? null,
          resolved_street: r.resolved_street_name,
          created_at: r.created_at,
        });
      }
    }
    if (r.user_confirmed_block !== null && r.user_confirmed_block !== undefined) {
      withFeedback++;
      if (apple.agreed_with_resolved === false && r.street_correct !== null) {
        if (r.street_correct === true) appleWrongOnDisagree++;
        else appleRightOnDisagree++;
      }
    }
  }

  const agreementRate = total > 0 ? agreed / total : 0;

  let recommendation: 'promote' | 'do_not_promote' | 'needs_more_data' | 'human_review';
  let reason: string;
  if (total < 30) {
    recommendation = 'needs_more_data';
    reason = `Only ${total} parking events with Apple data — need at least 30 before a confidence call.`;
  } else if (agreementRate >= 0.85) {
    recommendation = 'promote';
    reason = `Apple agreed with resolved street ${(agreementRate * 100).toFixed(0)}% of ${total} events. Safe to promote to tiebreaker — disagreements are rare and likely informative.`;
  } else if (agreementRate < 0.70) {
    recommendation = 'do_not_promote';
    reason = `Apple agreed only ${(agreementRate * 100).toFixed(0)}% of ${total} events. Promoting would introduce noise.`;
  } else {
    recommendation = 'human_review';
    reason = `Apple agreed ${(agreementRate * 100).toFixed(0)}% of ${total} events — borderline. Look at disagreement_samples to judge whether Apple's votes are useful.`;
  }

  if (withFeedback > 0 && (appleRightOnDisagree + appleWrongOnDisagree) > 0) {
    const acc = appleRightOnDisagree / (appleRightOnDisagree + appleWrongOnDisagree);
    reason += ` On ${appleRightOnDisagree + appleWrongOnDisagree} disagreements with user feedback, Apple was right ${(acc * 100).toFixed(0)}% of the time.`;
  }

  return res.status(200).json({
    window_days: days,
    since,
    total_events_with_apple: total,
    agreed_count: agreed,
    disagreed_count: disagreed,
    agreement_rate: Number(agreementRate.toFixed(4)),
    events_with_user_feedback: withFeedback,
    apple_right_on_disagreement: appleRightOnDisagree,
    apple_wrong_on_disagreement: appleWrongOnDisagree,
    recommendation,
    reason,
    disagreement_samples: disagreementSamples,
  });
}
