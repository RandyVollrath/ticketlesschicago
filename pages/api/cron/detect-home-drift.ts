import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { computeDriftForUser, DRIFT_THRESHOLDS, type DriftStatus } from '../../../lib/home-address-drift';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const ADMIN_EMAIL = 'randyvollrath@gmail.com';

// Daily cron: for each paid user with a stated home_address_section, compare
// to where they've actually been parking overnight (last 21 days). Insert a
// signal row per user. When a NEW drift is detected (prior signal wasn't
// already DRIFT_DETECTED), include in a daily admin digest emailed to
// randyvollrath@gmail.com.
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

  const drifts: DriftEntry[] = [];

  try {
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('user_id, home_address_ward, home_address_section, home_address_full')
      .eq('is_paid', true)
      .not('home_address_section', 'is', null)
      .neq('home_address_section', '');
    if (error) throw new Error(`user_profiles fetch: ${error.message}`);

    const nowIso = new Date().toISOString();

    for (const u of users || []) {
      const userId = (u as any).user_id as string;
      const homeAddressFull = (u as any).home_address_full as string | null;
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

        // Get the prior signal status BEFORE inserting this run's row, so we
        // can detect a status transition (e.g. AMBIGUOUS → DRIFT_DETECTED).
        const { data: priorRows, error: priorErr } = await supabase
          .from('home_address_drift_signals')
          .select('status')
          .eq('user_id', userId)
          .order('detected_at', { ascending: false })
          .limit(1);
        if (priorErr) throw new Error(`prior signal query: ${priorErr.message}`);
        const priorStatus = priorRows?.[0]?.status ?? null;

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

        summary[result.status]++;

        if (result.status === 'DRIFT_DETECTED') {
          // Look up the user's email for the admin digest.
          const { data: authUser } = await supabase.auth.admin.getUserById(userId);
          drifts.push({
            user_id: userId,
            user_email: authUser?.user?.email ?? null,
            home_address_full: homeAddressFull,
            home_label: `W${result.home_ward} S${result.home_section}`,
            candidate_label: `W${result.candidate_ward} S${result.candidate_section}`,
            candidate_fraction: result.candidate_fraction ?? 0,
            overnight_event_count: result.overnight_event_count,
            is_new: priorStatus !== 'DRIFT_DETECTED',
          });
        }
      } catch (e: any) {
        summary.errors++;
        console.error(`detect-home-drift user ${userId} error:`, e?.message || e);
      }
    }

    // Email only about new drifts. If a user has been in DRIFT_DETECTED status
    // for several days running, we already notified the admin on day 1.
    const newDrifts = drifts.filter((d) => d.is_new);
    let emailStatus: 'sent' | 'skipped_empty' | 'skipped_no_key' | 'failed' = 'skipped_empty';
    let emailError: string | null = null;

    const resendApiKey =
      process.env.RESEND_API_KEY;
    if (newDrifts.length > 0) {
      if (!resendApiKey) {
        emailStatus = 'skipped_no_key';
        console.warn('detect-home-drift: no resend key — skipping admin digest');
      } else {
        try {
          const resend = new Resend(resendApiKey);
          const subject = `[Admin] ${newDrifts.length} user${newDrifts.length === 1 ? '' : 's'} may have moved`;
          const html = renderDriftDigestHtml(newDrifts);
          const { error: sendErr } = await resend.emails.send({
            from: 'Autopilot America <alerts@autopilotamerica.com>',
            to: [ADMIN_EMAIL],
            subject,
            html,
          });
          if (sendErr) throw sendErr;
          emailStatus = 'sent';
        } catch (e: any) {
          emailStatus = 'failed';
          emailError = e?.message || String(e);
          console.error('detect-home-drift: admin email failed:', emailError);
        }
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      `detect-home-drift: checked ${users?.length ?? 0} users in ${elapsedMs}ms`,
      JSON.stringify(summary),
      drifts.length ? `drifts=${JSON.stringify(drifts.map((d) => ({ ...d, user_email: '<redacted>' })))}` : '',
      `email=${emailStatus}`
    );

    return res.status(200).json({
      checked: users?.length ?? 0,
      elapsed_ms: elapsedMs,
      thresholds: DRIFT_THRESHOLDS,
      summary,
      drifts_count: drifts.length,
      new_drifts_count: newDrifts.length,
      email_status: emailStatus,
      email_error: emailError,
    });
  } catch (e: any) {
    console.error('detect-home-drift fatal:', e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}

interface DriftEntry {
  user_id: string;
  user_email: string | null;
  home_address_full: string | null;
  home_label: string;
  candidate_label: string;
  candidate_fraction: number;
  overnight_event_count: number;
  is_new: boolean;
}

function renderDriftDigestHtml(drifts: DriftEntry[]): string {
  const rows = drifts
    .map((d) => {
      const pct = Math.round(d.candidate_fraction * 100);
      const email = escapeHtml(d.user_email || 'unknown');
      const home = escapeHtml(d.home_address_full || '—');
      return `
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 12px;font-size:13px;">${email}</td>
          <td style="padding:10px 12px;font-size:13px;">${home}</td>
          <td style="padding:10px 12px;font-size:13px;">${escapeHtml(d.home_label)}</td>
          <td style="padding:10px 12px;font-size:13px;font-weight:600;">${escapeHtml(d.candidate_label)}</td>
          <td style="padding:10px 12px;font-size:13px;">${pct}% (${d.overnight_event_count} nights)</td>
          <td style="padding:10px 12px;font-size:12px;color:#6b7280;">${escapeHtml(d.user_id)}</td>
        </tr>`;
    })
    .join('');

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:780px;margin:0 auto;padding:20px;">
      <h2 style="color:#1a1a1a;border-bottom:2px solid #e5e7eb;padding-bottom:12px;">
        Possible address moves — ${drifts.length} user${drifts.length === 1 ? '' : 's'}
      </h2>
      <p style="color:#6b7280;font-size:14px;">${today}</p>
      <p style="color:#374151;font-size:14px;line-height:1.5;">
        These users' phones have been parking overnight in a different ward+section
        from their stated home address — for at least 21 days, ≥70% of detected
        overnights at the new section. May indicate a move. Verify before changing
        their address.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;">
        <tr style="background:#f3f4f6;text-align:left;">
          <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">User</th>
          <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Stated home</th>
          <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Home W/S</th>
          <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Detected W/S</th>
          <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">Confidence</th>
          <th style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">User ID</th>
        </tr>
        ${rows}
      </table>
      <p style="color:#9ca3af;font-size:12px;margin-top:24px;">
        Internal-only signal. No notification sent to the user. Source table:
        <code>home_address_drift_signals</code>. Algorithm: <code>lib/home-address-drift.ts</code>.
      </p>
    </div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
