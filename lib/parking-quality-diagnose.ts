/**
 * Parking-quality diagnosis — deterministic data layer.
 *
 * Pulls the last N hours of parking_diagnostics, groups by user, classifies
 * each row by failure signature, and returns a structured report.
 *
 * Consumed by:
 *  - the on-demand skill workflow (.claude/skills/parking-quality-improver.md)
 *  - the daily email cron (pages/api/cron/parking-quality-daily.ts)
 *  - the CLI entry point (scripts/parking-quality-diagnose.ts)
 *
 * Lives under lib/ (not scripts/) so Vercel's serverless bundler can pull it
 * into an API route — Next.js does not bundle code outside the app tree.
 */

import { createClient } from '@supabase/supabase-js';

// Failure-signature classifier — each row gets one primary label.
// Ordered by precedence: more specific / actionable signatures first.
export type FailureSignature =
  | 'no_snap'                    // no street matched at all
  | 'snap_far'                   // snapped to street > 20m from GPS
  | 'nominatim_overrode'         // Nominatim contradicted the snap
  | 'heading_stale'              // GPS heading used after a turn
  | 'compass_missing'            // no compass heading captured
  | 'low_accuracy'               // raw GPS accuracy > 30m
  | 'user_said_street_wrong'    // ground truth: user flagged wrong street
  | 'user_said_side_wrong'      // ground truth: user flagged wrong side
  | 'autolabel_disagreed'       // post-park departure snap disagreed
  | 'walkaway_guard_fired'      // drift-after-park guard had to intervene
  | 'parity_forced'             // house-number parity had to be forced
  | 'healthy';

export interface ClassifiedRow {
  id: string;
  user_id: string;
  created_at: string;
  signature: FailureSignature;
  resolved_address: string | null;
  snap_street: string | null;
  nominatim_street: string | null;
  raw_accuracy_m: number | null;
  snap_distance_m: number | null;
  heading_source: string | null;
  gps_source: string | null;
  auto_label: any;
  user_feedback_at: string | null;
  street_correct: boolean | null;
  side_correct: boolean | null;
  location_error_m: number | null;
}

export interface UserSummary {
  user_id: string;
  email: string | null;
  total_checks: number;
  healthy_checks: number;
  avg_accuracy_m: number | null;
  failure_counts: Record<FailureSignature, number>;
  user_feedback_rows: number;
  street_correct_rate: number | null; // percent
  side_correct_rate: number | null;
  worst_signatures: FailureSignature[];
  example_failures: ClassifiedRow[];
}

export interface DiagnosisReport {
  window_start: string;
  window_end: string;
  hours: number;
  total_rows: number;
  total_users: number;
  overall_failure_counts: Record<FailureSignature, number>;
  per_user: UserSummary[];
  top_signatures: Array<{ signature: FailureSignature; count: number; userCount: number; examples: ClassifiedRow[] }>;
  prior_reports: Array<{ generated_at: string; total_checks: number; pct_no_snap: number | null; avg_raw_accuracy_m: number | null }>;
}

function classify(row: any): FailureSignature {
  if (row.user_feedback_at && row.street_correct === false) return 'user_said_street_wrong';
  if (row.user_feedback_at && row.side_correct === false) return 'user_said_side_wrong';
  if (!row.snap_street_name) return 'no_snap';
  if ((row.snap_distance_meters || 0) > 20) return 'snap_far';
  if (row.nominatim_overrode) return 'nominatim_overrode';
  if (row.walkaway_guard_fired) return 'walkaway_guard_fired';
  const al = row.native_meta?.auto_label;
  if (al && al.street_matched === false) return 'autolabel_disagreed';
  if (row.heading_source === 'stale' || row.heading_source === 'none') return 'heading_stale';
  if (!row.compass_heading && !row.gps_heading) return 'compass_missing';
  if ((row.raw_accuracy_meters || 0) > 30) return 'low_accuracy';
  if (row.parity_forced) return 'parity_forced';
  return 'healthy';
}

function emptyCounts(): Record<FailureSignature, number> {
  return {
    no_snap: 0, snap_far: 0, nominatim_overrode: 0, heading_stale: 0,
    compass_missing: 0, low_accuracy: 0, user_said_street_wrong: 0,
    user_said_side_wrong: 0, autolabel_disagreed: 0, walkaway_guard_fired: 0,
    parity_forced: 0, healthy: 0,
  };
}

export async function diagnose(hours: number = 24): Promise<DiagnosisReport> {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - hours * 60 * 60 * 1000);

  const { data: rows, error } = await s
    .from('parking_diagnostics')
    .select('*')
    .gte('created_at', windowStart.toISOString())
    .lt('created_at', windowEnd.toISOString())
    .order('created_at', { ascending: false });
  if (error) throw new Error(`parking_diagnostics fetch: ${error.message}`);

  const classified: ClassifiedRow[] = (rows || []).map(r => ({
    id: r.id,
    user_id: r.user_id,
    created_at: r.created_at,
    signature: classify(r),
    resolved_address: r.resolved_address,
    snap_street: r.snap_street_name,
    nominatim_street: r.nominatim_street,
    raw_accuracy_m: r.raw_accuracy_meters,
    snap_distance_m: r.snap_distance_meters,
    heading_source: r.heading_source,
    gps_source: r.gps_source,
    auto_label: r.native_meta?.auto_label,
    user_feedback_at: r.user_feedback_at,
    street_correct: r.street_correct,
    side_correct: r.side_correct,
    location_error_m: r.location_error_meters,
  }));

  // Per-user aggregation
  const byUser = new Map<string, ClassifiedRow[]>();
  for (const c of classified) {
    const arr = byUser.get(c.user_id) || [];
    arr.push(c);
    byUser.set(c.user_id, arr);
  }

  // Fetch emails for each user_id we saw
  const userIds = Array.from(byUser.keys());
  const emailMap = new Map<string, string>();
  for (const uid of userIds) {
    try {
      const { data } = await s.auth.admin.getUserById(uid);
      if (data?.user?.email) emailMap.set(uid, data.user.email);
    } catch { /* skip */ }
  }

  const perUser: UserSummary[] = [];
  for (const [userId, userRows] of byUser.entries()) {
    const counts = emptyCounts();
    for (const c of userRows) counts[c.signature]++;

    const accuracies = userRows.map(c => c.raw_accuracy_m).filter(v => typeof v === 'number') as number[];
    const avgAcc = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null;

    const feedbackRows = userRows.filter(c => c.user_feedback_at);
    const streetConfirmed = feedbackRows.filter(c => c.street_correct !== null);
    const sideConfirmed = feedbackRows.filter(c => c.side_correct !== null);
    const streetCorrectRate = streetConfirmed.length
      ? Math.round(100 * streetConfirmed.filter(c => c.street_correct === true).length / streetConfirmed.length)
      : null;
    const sideCorrectRate = sideConfirmed.length
      ? Math.round(100 * sideConfirmed.filter(c => c.side_correct === true).length / sideConfirmed.length)
      : null;

    // Worst signatures for THIS user — sorted desc by count, excluding healthy.
    const worst = (Object.entries(counts) as [FailureSignature, number][])
      .filter(([sig, n]) => sig !== 'healthy' && n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([sig]) => sig);

    const exampleFailures = userRows
      .filter(c => c.signature !== 'healthy')
      .slice(0, 5);

    perUser.push({
      user_id: userId,
      email: emailMap.get(userId) || null,
      total_checks: userRows.length,
      healthy_checks: counts.healthy,
      avg_accuracy_m: avgAcc != null ? Math.round(avgAcc * 10) / 10 : null,
      failure_counts: counts,
      user_feedback_rows: feedbackRows.length,
      street_correct_rate: streetCorrectRate,
      side_correct_rate: sideCorrectRate,
      worst_signatures: worst,
      example_failures: exampleFailures,
    });
  }

  // Overall + top signatures
  const overall = emptyCounts();
  for (const c of classified) overall[c.signature]++;

  const topSigs: DiagnosisReport['top_signatures'] = (Object.entries(overall) as [FailureSignature, number][])
    .filter(([sig, n]) => sig !== 'healthy' && n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sig, count]) => {
      const users = new Set(classified.filter(c => c.signature === sig).map(c => c.user_id));
      const examples = classified.filter(c => c.signature === sig).slice(0, 3);
      return { signature: sig, count, userCount: users.size, examples };
    });

  // Prior reports for trend
  const { data: priorReports } = await s
    .from('parking_quality_reports')
    .select('generated_at, total_checks, pct_no_snap, avg_raw_accuracy_m')
    .order('generated_at', { ascending: false })
    .limit(5);

  return {
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    hours,
    total_rows: classified.length,
    total_users: userIds.length,
    overall_failure_counts: overall,
    per_user: perUser.sort((a, b) => (b.total_checks - a.total_checks)),
    top_signatures: topSigs,
    prior_reports: (priorReports || []) as any,
  };
}
