/**
 * Cron Job: Paid-user health check
 *
 * Runs daily. For every user marked `is_paid: true` who signed up in the last
 * 30 days, verifies the rows that actually block ticket contesting are present:
 *
 *   1. user_profiles.license_plate           — what plate to monitor
 *   2. user_profiles.contest_consent=true    — legal go-ahead to file letters
 *   3. monitored_plates row, status=active   — portal scraper input
 *   4. autopilot_subscriptions row, active   — pipeline entitlement
 *
 * If anything is missing, email a digest to ADMIN_ALERT_EMAILS so we can
 * backfill before the user notices.
 *
 * Why only the last 30 days: legacy / manually-comped accounts often lack
 * these rows on purpose; alerting on them every night is just noise. The goal
 * here is to catch *fresh* Jazz-class bugs — a new signup path forgot a step.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Resend } from 'resend';
import { supabaseAdmin } from '../../../lib/supabase';

interface Issue {
  user_id: string;
  email: string;
  created_at: string;
  missing: string[];
}

async function alertOps(subject: string, body: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'noreply@autopilotamerica.com';
  const to = (process.env.ADMIN_ALERT_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!apiKey || to.length === 0) {
    console.error('[paid-user-health] Cannot send alert — RESEND_API_KEY or ADMIN_ALERT_EMAILS missing');
    return;
  }
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to, subject, text: body });
    console.log(`[paid-user-health] Alert email sent to ${to.join(', ')}`);
  } catch (err) {
    console.error('[paid-user-health] Failed to send Resend alert:', err);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  const cutoffIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: paidUsersRaw, error } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, license_plate, contest_consent, created_at')
    .eq('is_paid', true)
    .gte('created_at', cutoffIso);

  // Test/QA accounts under our own domain (qa-bot, appreview, playreview…)
  // are intentionally incomplete; skip them so they don't fire every night.
  const paidUsers = (paidUsersRaw || []).filter(
    u => !u.email?.endsWith('@autopilotamerica.com')
  );

  if (error) {
    console.error('[paid-user-health] Failed to load paid users:', error);
    await alertOps(
      '[ALERT] paid-user health check FAILED to run',
      `Could not query user_profiles: ${error.message}\n\nNo paid users were verified. Investigate.`
    );
    return res.status(500).json({ error: error.message });
  }

  const issues: Issue[] = [];

  for (const u of paidUsers || []) {
    const missing: string[] = [];

    if (!u.license_plate) missing.push('user_profiles.license_plate');
    if (!u.contest_consent) missing.push('user_profiles.contest_consent');

    const [{ data: plates }, { data: subs }] = await Promise.all([
      supabaseAdmin.from('monitored_plates').select('id').eq('user_id', u.user_id).eq('status', 'active').limit(1),
      supabaseAdmin.from('autopilot_subscriptions').select('id').eq('user_id', u.user_id).eq('status', 'active').limit(1),
    ]);

    if (!plates || plates.length === 0) missing.push('monitored_plates (active)');
    if (!subs || subs.length === 0) missing.push('autopilot_subscriptions (active)');

    if (missing.length > 0) {
      issues.push({
        user_id: u.user_id,
        email: u.email,
        created_at: u.created_at,
        missing,
      });
    }
  }

  const totalChecked = paidUsers?.length || 0;
  console.log(`[paid-user-health] Checked ${totalChecked} recent paid users, ${issues.length} have missing rows`);

  if (issues.length > 0) {
    const lines = issues.map(i =>
      `• ${i.email} (id=${i.user_id}, signed up ${i.created_at})\n    missing: ${i.missing.join(', ')}`
    );
    const body =
      `Daily paid-user health check found ${issues.length} of ${totalChecked} recent paid users (last 30 days) ` +
      `missing rows that block ticket contesting.\n\n` +
      `Each user below has is_paid=true but at least one of: license_plate, contest_consent, ` +
      `monitored_plates(active), autopilot_subscriptions(active) is missing.\n\n` +
      lines.join('\n\n');

    await alertOps(`[ALERT] ${issues.length} recent paid user${issues.length === 1 ? '' : 's'} half-set-up`, body);
  }

  // ─── Late Fee Protection: stuck autopay charges ───
  // A letter that's been autopay_status='charged_pending_city' for more
  // than 6 hours means the city payment worker is offline or stuck.
  // Flag these so we can investigate before the timeout-refund cron acts.
  const stuckCutoffIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data: stuckCharges } = await supabaseAdmin
    .from('contest_letters')
    .select('id, user_id, autopay_attempted_at, autopay_status, stripe_payment_intent_id')
    .eq('autopay_status', 'charged_pending_city')
    .lte('autopay_attempted_at', stuckCutoffIso);

  if (stuckCharges && stuckCharges.length > 0) {
    const lines = stuckCharges.map(c =>
      `• letter=${c.id} | charged ${c.autopay_attempted_at} | PI=${c.stripe_payment_intent_id}`
    );
    await alertOps(
      `[ALERT] ${stuckCharges.length} autopay charge${stuckCharges.length === 1 ? '' : 's'} stuck >6h pending city payment`,
      `These contest letters had Stripe charge succeed but the city_payment_queue worker has not completed payment within 6 hours. The auto-refund cron will refund automatically after 48h, but investigate sooner if this is unexpected.\n\n${lines.join('\n')}\n\nLikely causes: city_payment_queue worker offline, City of Chicago portal down, payment-form selectors broke.`,
    );
  }

  return res.status(200).json({
    status: (issues.length === 0 && (!stuckCharges || stuckCharges.length === 0)) ? 'healthy' : 'issues_found',
    checked: totalChecked,
    issuesFound: issues.length,
    stuckAutopayCharges: stuckCharges?.length || 0,
    issues,
  });
}
