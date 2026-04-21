/**
 * Daily personalized parking-quality report → randyvollrath@gmail.com.
 *
 * Runs once a day. Uses the deterministic `diagnose()` function to pull
 * last 24h of parking data grouped by user, then asks Claude to write
 * SHORT plain-language what's-working / what-isn't / proposed-fix
 * paragraphs grounded in the actual row data. Emails the result.
 *
 * This does NOT ship any code changes. The "proposed solution" in each
 * email is a written suggestion for the human to review — the on-demand
 * `.claude/skills/parking-quality-improver.md` workflow is what turns
 * a suggestion into an actual branch.
 *
 * Schedule: 13:00 UTC = 8am Chicago (1 line in vercel.json).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import Anthropic from '@anthropic-ai/sdk';
import { diagnose, type DiagnosisReport } from '../../../lib/parking-quality-diagnose';
import { sendEmailWithRetry } from '../../../lib/resend-with-retry';
import { Resend } from 'resend';

export const config = { maxDuration: 120 };

const DESTINATION_EMAIL = 'randyvollrath@gmail.com';
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60_000 })
  : null;
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface AiAnalysis {
  headline: string;
  whats_working: string;
  whats_not: string;
  proposed_solutions: Array<{ for: string; solution: string; file_hint?: string }>;
}

async function askClaudeForAnalysis(report: DiagnosisReport): Promise<AiAnalysis | null> {
  if (!anthropic) return null;
  // Keep the prompt compact — the model performs better on focused input.
  // We include the full per-user breakdown but trim native_meta blobs.
  const compactReport = {
    ...report,
    per_user: report.per_user.map(u => ({
      user_id: u.user_id.slice(0, 8) + '…',
      email: u.email,
      total_checks: u.total_checks,
      healthy_checks: u.healthy_checks,
      avg_accuracy_m: u.avg_accuracy_m,
      failure_counts: u.failure_counts,
      user_feedback_rows: u.user_feedback_rows,
      street_correct_rate: u.street_correct_rate,
      side_correct_rate: u.side_correct_rate,
      worst_signatures: u.worst_signatures,
      example_failures: u.example_failures.map(e => ({
        id: e.id,
        signature: e.signature,
        resolved_address: e.resolved_address,
        snap_street: e.snap_street,
        nominatim_street: e.nominatim_street,
        raw_accuracy_m: e.raw_accuracy_m,
        snap_distance_m: e.snap_distance_m,
        heading_source: e.heading_source,
        gps_source: e.gps_source,
        autolabel_saved: e.auto_label?.saved_address,
        autolabel_snap: e.auto_label?.departure_snap_street,
        street_correct: e.street_correct,
      })),
    })),
  };

  const prompt = `You are reading a 24-hour parking-detection quality report for Autopilot America (Chicago parking app). Produce a SHORT, plain-language daily digest for the founder. Be grounded in the actual data; do not speculate beyond what the rows show.

Output STRICT JSON with this exact shape (no prose outside the JSON):

{
  "headline": "<one-sentence overall state — what's most important to know today>",
  "whats_working": "<2-4 sentences describing what IS working well, citing specific signatures or users. Mention the best-performing user by email if there's a clear winner. Cite real numbers.>",
  "whats_not": "<2-4 sentences describing what ISN'T working. Name the top failure signature by volume, name the most-affected user by email, cite 1-2 example diagnostic row IDs. Use plain language.>",
  "proposed_solutions": [
    { "for": "<failure signature or pattern>", "solution": "<one concrete suggestion — e.g. 'tighten the snap-distance threshold from 30m to 20m for stop_start GPS sources' or 'inspect check-parking.ts:217 — heading-stale guard may not be firing when compass_confidence is low'>", "file_hint": "<path:line if known, else null>" }
  ]
}

Rules:
- Cite specific diagnostic row IDs in whats_not where relevant, using "#id" format.
- Never propose a solution backed by fewer than 2 example rows — if the data is thin, say so.
- Only include users with at least 3 checks in per-user callouts.
- Keep every string under 400 characters.

REPORT DATA:
${JSON.stringify(compactReport, null, 2)}`;

  try {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1800,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const jsonStart = cleaned.indexOf('{');
    const jsonEnd = cleaned.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) return null;
    return JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
  } catch (e: any) {
    console.error('Claude analysis failed:', e?.message);
    return null;
  }
}

function renderHtml(report: DiagnosisReport, ai: AiAnalysis | null): string {
  const windowLabel = `${report.window_start.slice(0, 16).replace('T', ' ')} → ${report.window_end.slice(0, 16).replace('T', ' ')} UTC`;
  const topSigRows = report.top_signatures.map(s =>
    `<tr><td>${s.signature}</td><td>${s.count}</td><td>${s.userCount}</td></tr>`
  ).join('');

  const perUserCards = report.per_user.map(u => {
    const topFail = u.worst_signatures[0] || '—';
    const failLine = u.worst_signatures.length
      ? u.worst_signatures.slice(0, 3).map(s => `<code>${s}</code> (${u.failure_counts[s]})`).join(', ')
      : 'all healthy';
    const feedback = u.user_feedback_rows > 0
      ? `${u.user_feedback_rows} user-feedback row${u.user_feedback_rows === 1 ? '' : 's'} · street-correct ${u.street_correct_rate ?? '—'}%${u.side_correct_rate != null ? ` · side-correct ${u.side_correct_rate}%` : ''}`
      : 'no user feedback';
    return `
      <div style="border-left: 4px solid #2563EB; padding: 10px 14px; margin: 10px 0; background: #f8fafc;">
        <div style="font-weight: 600;">${u.email || u.user_id.slice(0, 8) + '…'}</div>
        <div style="font-size: 13px; color: #374151;">
          ${u.total_checks} checks · ${u.healthy_checks} healthy · avg ${u.avg_accuracy_m ?? '—'} m<br>
          top issues: ${failLine}<br>
          ${feedback}
        </div>
      </div>
    `;
  }).join('');

  const aiBlock = ai ? `
    <h2 style="color: #1e3a8a;">Today's digest</h2>
    <p style="font-size: 15px;"><strong>${escapeHtml(ai.headline)}</strong></p>
    <h3 style="color: #059669; margin-top: 20px;">What's working</h3>
    <p>${escapeHtml(ai.whats_working)}</p>
    <h3 style="color: #dc2626; margin-top: 20px;">What's not</h3>
    <p>${escapeHtml(ai.whats_not)}</p>
    <h3 style="color: #7c3aed; margin-top: 20px;">Proposed solutions</h3>
    <ol>
      ${ai.proposed_solutions.map(s => `
        <li style="margin-bottom: 10px;">
          <strong>For ${escapeHtml(s.for)}:</strong> ${escapeHtml(s.solution)}
          ${s.file_hint ? `<br><code style="font-size: 12px; color: #6b7280;">${escapeHtml(s.file_hint)}</code>` : ''}
        </li>
      `).join('')}
    </ol>
  ` : '<p><em>Claude analysis unavailable — showing raw data only.</em></p>';

  return `
    <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width: 700px; margin: 0 auto; padding: 20px;">
      <h1 style="color: #0f172a;">Parking Quality — Daily</h1>
      <p style="color: #6b7280; font-size: 13px;">${windowLabel}</p>
      <p style="font-size: 14px;">
        <strong>${report.total_rows}</strong> checks across <strong>${report.total_users}</strong> users ·
        <strong>${report.overall_failure_counts.healthy}</strong> healthy ·
        <strong>${report.total_rows - report.overall_failure_counts.healthy}</strong> failures
      </p>
      ${aiBlock}
      <h3 style="margin-top: 24px; color: #0f172a;">Top failure signatures</h3>
      <table style="border-collapse: collapse; font-size: 13px;">
        <thead><tr style="background: #f3f4f6;"><th style="padding: 6px 10px; text-align: left;">Signature</th><th style="padding: 6px 10px;">Count</th><th style="padding: 6px 10px;">Users affected</th></tr></thead>
        <tbody>${topSigRows || '<tr><td colspan="3"><em>all healthy</em></td></tr>'}</tbody>
      </table>
      <h3 style="margin-top: 24px; color: #0f172a;">Per-user breakdown</h3>
      ${perUserCards || '<p><em>no activity in this window</em></p>'}
      <hr style="margin-top: 30px; border: 0; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 11px; color: #9ca3af;">
        Source: <code>parking_diagnostics</code> · <code>parking_location_history</code><br>
        Deeper analysis with proposed patches: invoke the <code>/parking-quality-improver</code> skill in Claude Code.
      </p>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const cronAuth = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (cronAuth ? req.headers.authorization === `Bearer ${cronAuth}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const report = await diagnose(24);
    const ai = await askClaudeForAnalysis(report);

    const html = renderHtml(report, ai);
    const subject = ai?.headline
      ? `Parking quality — ${ai.headline.slice(0, 80)}`
      : `Parking quality — ${report.total_rows} checks, ${report.total_rows - report.overall_failure_counts.healthy} failures`;

    if (resend && process.env.RESEND_API_KEY) {
      await sendEmailWithRetry(resend, {
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [DESTINATION_EMAIL],
        subject,
        html,
      });
    }

    return res.status(200).json({
      success: true,
      total_rows: report.total_rows,
      total_users: report.total_users,
      has_ai_analysis: !!ai,
    });
  } catch (e: any) {
    console.error('parking-quality-daily failed:', e?.message);
    return res.status(500).json({ error: e?.message || 'unknown error' });
  }
}
