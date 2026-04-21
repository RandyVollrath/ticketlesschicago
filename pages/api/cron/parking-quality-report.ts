/**
 * Parking-detection quality report — runs twice daily.
 *
 * Pulls the last 12 hours of parking_diagnostics + parking_location_history
 * rows, computes quality metrics, writes a row to parking_quality_reports,
 * and emails the admin alert list with a diff against the prior window.
 *
 * Schedule (vercel.json):
 *   - 0 5  * * *   (midnight Chicago, 12h of evening-to-morning traffic)
 *   - 0 17 * * *   (noon Chicago, 12h of morning-to-noon traffic)
 *
 * The goal is iterative improvement — each report compares against the
 * prior one so regressions surface fast.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sendEmailWithRetry } from '../../../lib/resend-with-retry';
import { getAdminAlertEmails } from '../../../lib/admin-alert-emails';
import { Resend } from 'resend';

export const config = { maxDuration: 120 };

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const WINDOW_HOURS = 12;

type Diag = any;

function pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 1000) / 10;
}

function formatDelta(curr: number | null, prev: number | null, suffix = '%'): string {
  if (curr == null || prev == null) return '—';
  const diff = curr - prev;
  const sign = diff > 0 ? '+' : '';
  return `${curr}${suffix} (${sign}${(Math.round(diff * 10) / 10)}${suffix})`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? req.headers.authorization === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - WINDOW_HOURS * 60 * 60 * 1000);

  // ── Pull current window ──
  const { data: diagnostics, error: diagErr } = await supabaseAdmin
    .from('parking_diagnostics')
    .select('*')
    .gte('created_at', windowStart.toISOString())
    .lt('created_at', windowEnd.toISOString());

  if (diagErr) {
    return res.status(500).json({ error: diagErr.message });
  }

  const rows: Diag[] = diagnostics || [];
  const total = rows.length;

  // ── Volume ──
  const auto = rows.filter(r =>
    (r.gps_source && r.gps_source !== 'manual') ||
    (r.native_meta && (r.native_meta.detectionSource || r.native_meta.auto_label))
  ).length;
  const manual = total - auto;

  // ── Accuracy ──
  const accuracies = rows.map(r => Number(r.raw_accuracy_meters) || null).filter(v => v != null) as number[];
  const avgAccuracy = accuracies.length ? (accuracies.reduce((a, b) => a + b, 0) / accuracies.length) : null;
  const under10 = accuracies.filter(v => v <= 10).length;
  const over30 = accuracies.filter(v => v > 30).length;

  // ── Snap quality ──
  const noSnap = rows.filter(r => !r.snap_street_name).length;
  const snapFar = rows.filter(r => (Number(r.snap_distance_meters) || 0) > 20).length;
  const nominatimOverrode = rows.filter(r => r.nominatim_overrode).length;
  const headingConfirmed = rows.filter(r => r.heading_confirmed_snap).length;

  // ── Guards ──
  const walkaway = rows.filter(r => r.walkaway_guard_fired).length;
  const parityForced = rows.filter(r => r.parity_forced).length;

  // ── User feedback ──
  const feedbackRows = rows.filter(r => r.user_feedback_at);
  const streetCorrect = feedbackRows.filter(r => r.street_correct === true).length;
  const streetWrong = feedbackRows.filter(r => r.street_correct === false).length;
  const sideCorrect = feedbackRows.filter(r => r.side_correct === true).length;
  const sideWrong = feedbackRows.filter(r => r.side_correct === false).length;
  const streetCorrectPct = (streetCorrect + streetWrong) > 0
    ? pct(streetCorrect, streetCorrect + streetWrong)
    : null;

  // ── Auto-label mismatch (post-park departure snap disagreed with saved street) ──
  const autolabelMismatch = rows.filter(r => {
    const al = r.native_meta?.auto_label;
    return al && al.street_matched === false;
  }).length;

  // ── History-side signals ──
  const { data: histRows } = await supabaseAdmin
    .from('parking_location_history')
    .select('id, address, parked_at, departure_confirmed_at, cleared_at')
    .gte('created_at', windowStart.toISOString())
    .lt('created_at', windowEnd.toISOString());

  const history = histRows || [];
  // Coord-like addresses: "41.9082, -87.6898" pattern.
  const coordLike = history.filter(h => /^-?\d+\.\d+\s*,\s*-?\d+\.\d+$/.test((h.address || '').trim())).length;

  // Stale parks > 48h: this is a 7-day lookback, not a 12h window, because
  // a stale park won't show up in the current 12h window.
  const staleCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: staleRows } = await supabaseAdmin
    .from('parking_location_history')
    .select('id, parked_at, cleared_at, departure_confirmed_at')
    .gte('parked_at', weekAgo)
    .lt('parked_at', staleCutoff);
  const stalePark = (staleRows || []).filter(r => !r.departure_confirmed_at).length;

  // ── Prior window for trend ──
  const { data: prevReport } = await supabaseAdmin
    .from('parking_quality_reports')
    .select('*')
    .order('generated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── Assemble payload ──
  const metrics = {
    window_start: windowStart.toISOString(),
    window_end: windowEnd.toISOString(),
    total_checks: total,
    auto_checks: auto,
    manual_checks: manual,
    avg_raw_accuracy_m: avgAccuracy != null ? Math.round(avgAccuracy * 10) / 10 : null,
    pct_accuracy_under_10m: pct(under10, accuracies.length),
    pct_accuracy_over_30m: pct(over30, accuracies.length),
    pct_no_snap: pct(noSnap, total),
    pct_snap_over_20m: pct(snapFar, total),
    pct_nominatim_overrode: pct(nominatimOverrode, total),
    pct_heading_confirmed: pct(headingConfirmed, total),
    pct_walkaway_guard_fired: pct(walkaway, total),
    pct_parity_forced: pct(parityForced, total),
    user_feedback_count: feedbackRows.length,
    street_correct_count: streetCorrect,
    street_wrong_count: streetWrong,
    side_correct_count: sideCorrect,
    side_wrong_count: sideWrong,
    pct_street_correct_when_confirmed: streetCorrectPct,
    autolabel_mismatch_count: autolabelMismatch,
    coord_like_address_count: coordLike,
    stale_parks_no_departure_count: stalePark,
    prev_window_total: prevReport?.total_checks ?? null,
  };

  // ── Write report row ──
  const { error: insertErr } = await supabaseAdmin
    .from('parking_quality_reports')
    .insert({
      ...metrics,
      raw_metrics: metrics,
    });

  if (insertErr) {
    console.error('Failed to insert parking_quality_reports row:', insertErr.message);
  }

  // ── Build email ──
  const delta = (curr: number | null, prev: number | null) => formatDelta(curr, prev);
  const pd = prevReport as any;
  const windowLabel = `${windowStart.toISOString().slice(0, 16).replace('T', ' ')} → ${windowEnd.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

  // Simple regression flags — items worth flagging in the email subject.
  const alerts: string[] = [];
  if (pd) {
    if ((metrics.pct_no_snap || 0) > (pd.pct_no_snap || 0) + 5) alerts.push('no-snap rate up');
    if ((metrics.pct_snap_over_20m || 0) > (pd.pct_snap_over_20m || 0) + 5) alerts.push('snap distance up');
    if ((metrics.avg_raw_accuracy_m || 0) > (pd.avg_raw_accuracy_m || 0) + 5) alerts.push('accuracy worsened');
    if ((metrics.pct_street_correct_when_confirmed ?? 100) < (pd.pct_street_correct_when_confirmed ?? 100) - 5) alerts.push('street-correct rate dropped');
    if ((metrics.autolabel_mismatch_count || 0) > (pd.autolabel_mismatch_count || 0) + 2) alerts.push('autolabel mismatches up');
  }

  const subject = alerts.length > 0
    ? `⚠️ Parking quality regression — ${alerts.join(', ')} (${windowLabel})`
    : `Parking quality report — ${windowLabel}`;

  const html = `
    <h2>Parking Detection Quality — last ${WINDOW_HOURS}h</h2>
    <p><em>${windowLabel}</em></p>
    <table style="border-collapse: collapse; font-family: monospace;">
      <tr><td>Total checks:</td><td>${metrics.total_checks}${pd ? ` (prev ${pd.total_checks})` : ''}</td></tr>
      <tr><td>  auto / manual:</td><td>${metrics.auto_checks} / ${metrics.manual_checks}</td></tr>
      <tr><td colspan="2"><hr></td></tr>
      <tr><td>Avg raw accuracy:</td><td>${metrics.avg_raw_accuracy_m ?? '—'} m ${pd ? `(prev ${pd.avg_raw_accuracy_m ?? '—'} m)` : ''}</td></tr>
      <tr><td>  ≤10m:</td><td>${delta(metrics.pct_accuracy_under_10m, pd?.pct_accuracy_under_10m)}</td></tr>
      <tr><td>  >30m:</td><td>${delta(metrics.pct_accuracy_over_30m, pd?.pct_accuracy_over_30m)}</td></tr>
      <tr><td colspan="2"><hr></td></tr>
      <tr><td>No-snap:</td><td>${delta(metrics.pct_no_snap, pd?.pct_no_snap)}</td></tr>
      <tr><td>Snap &gt;20m away:</td><td>${delta(metrics.pct_snap_over_20m, pd?.pct_snap_over_20m)}</td></tr>
      <tr><td>Nominatim overrode snap:</td><td>${delta(metrics.pct_nominatim_overrode, pd?.pct_nominatim_overrode)}</td></tr>
      <tr><td>Heading confirmed snap:</td><td>${delta(metrics.pct_heading_confirmed, pd?.pct_heading_confirmed)}</td></tr>
      <tr><td colspan="2"><hr></td></tr>
      <tr><td>Walkaway guard fired:</td><td>${delta(metrics.pct_walkaway_guard_fired, pd?.pct_walkaway_guard_fired)}</td></tr>
      <tr><td>Parity forced:</td><td>${delta(metrics.pct_parity_forced, pd?.pct_parity_forced)}</td></tr>
      <tr><td colspan="2"><hr></td></tr>
      <tr><td>User feedback rows:</td><td>${metrics.user_feedback_count} ${pd ? `(prev ${pd.user_feedback_count})` : ''}</td></tr>
      <tr><td>  street correct / wrong:</td><td>${metrics.street_correct_count} / ${metrics.street_wrong_count}</td></tr>
      <tr><td>  street-correct rate:</td><td>${metrics.pct_street_correct_when_confirmed ?? '—'}% ${pd ? `(prev ${pd.pct_street_correct_when_confirmed ?? '—'}%)` : ''}</td></tr>
      <tr><td>  side correct / wrong:</td><td>${metrics.side_correct_count} / ${metrics.side_wrong_count}</td></tr>
      <tr><td colspan="2"><hr></td></tr>
      <tr><td>Autolabel mismatch (post-park departure snap disagreed):</td><td>${metrics.autolabel_mismatch_count}</td></tr>
      <tr><td>Coord-like addresses leaked to history:</td><td>${metrics.coord_like_address_count}</td></tr>
      <tr><td>Stale parks (&gt;48h, no departure):</td><td>${metrics.stale_parks_no_departure_count}</td></tr>
    </table>
    ${alerts.length ? `<h3 style="color: #dc2626;">⚠️ Regressions</h3><ul>${alerts.map(a => `<li>${a}</li>`).join('')}</ul>` : ''}
    <p style="font-size: 12px; color: #666;">Source: <code>parking_diagnostics</code> and <code>parking_location_history</code>. Raw metrics stored in <code>parking_quality_reports.raw_metrics</code>.</p>
  `;

  // ── Email ──
  if (resend && process.env.RESEND_API_KEY) {
    try {
      await sendEmailWithRetry(resend, {
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: getAdminAlertEmails(),
        subject,
        html,
      });
    } catch (e: any) {
      console.error('Parking quality report email failed:', e?.message);
    }
  }

  return res.status(200).json({ success: true, metrics, alerts });
}
