/**
 * Webhook Health Check — daily audit
 *
 * Runs once a day and verifies:
 *   1. Each webhook provider's signing secret env var is set (fail-closed).
 *   2. We can reach each webhook provider's API with our API key.
 *   3. The Resend webhooks we registered still exist AND their endpoints
 *      point at production URLs we actually serve.
 *   4. The tables each webhook writes to are reachable.
 *
 * If anything fails, email randyvollrath@gmail.com. Otherwise stay quiet.
 *
 * Schedule: once a day (configured in vercel.json). Also callable manually
 * via GET with Authorization: Bearer <CRON_SECRET>.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { verifyCronAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function check(name: string, fn: () => Promise<string>): Promise<CheckResult> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (e: any) {
    return { name, ok: false, detail: sanitizeErrorMessage(e) };
  }
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = [];

  // ── Env var presence (each webhook handler is fail-closed if unset) ──
  for (const envVar of [
    'RESEND_WEBHOOK_SECRET',
    'RESEND_RECEIPTS_WEBHOOK_SECRET',
    'CLICKSEND_WEBHOOK_SECRET',
    'LOB_WEBHOOK_SECRET',
    'CLOUDFLARE_EMAIL_WORKER_SECRET',
    'CRON_SECRET',
  ]) {
    results.push(await check(`env:${envVar}`, async () => {
      const v = process.env[envVar];
      if (!v) throw new Error('not set');
      if (v.length < 10) throw new Error('suspiciously short');
      return `set (${v.length} chars)`;
    }));
  }

  // ── Resend webhooks registered + endpoint URLs sane ──
  results.push(await check('resend:webhooks-registered', async () => {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not set');
    const resp = await fetch('https://api.resend.com/webhooks', {
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    });
    if (!resp.ok) throw new Error(`Resend API returned ${resp.status}`);
    const body = await resp.json() as any;
    const webhooks = body.data || [];
    if (!webhooks.length) throw new Error('no webhooks registered');

    const expected = [
      '/api/webhooks/resend-incoming-email',
      '/api/webhooks/receipt-forwarding',
    ];
    const endpoints = webhooks.map((w: any) => w.endpoint as string);
    for (const path of expected) {
      const found = endpoints.some(e => e.endsWith(path));
      if (!found) throw new Error(`expected endpoint with path ${path} not found`);
    }
    const disabled = webhooks.filter((w: any) => w.status !== 'enabled');
    if (disabled.length) {
      throw new Error(`${disabled.length} webhook(s) disabled: ${disabled.map((w: any) => w.endpoint).join(', ')}`);
    }
    return `${webhooks.length} webhooks, all enabled, expected endpoints present`;
  }));

  // ── Stripe webhook key reachable ──
  results.push(await check('stripe:api-key', async () => {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
    const resp = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=1', {
      headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    });
    if (!resp.ok) throw new Error(`Stripe API returned ${resp.status}`);
    return 'reachable';
  }));

  // ── Tables written by webhook handlers exist + readable ──
  for (const table of [
    'registration_evidence_receipts',
    'incoming_sms',
    'foia_history_requests',
    'user_profiles',
    'ticket_contests',
  ]) {
    results.push(await check(`db:${table}`, async () => {
      const { error, count } = await supabase
        .from(table as any)
        .select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return `reachable (${count} rows)`;
    }));
  }

  // ── Supabase storage buckets webhook handlers write to ──
  for (const bucket of ['residency-proofs-temps', 'registration-evidence', 'ticket-photos', 'contest-evidence']) {
    results.push(await check(`storage:${bucket}`, async () => {
      const { error } = await supabase.storage.from(bucket).list('', { limit: 1 });
      if (error) throw new Error(error.message);
      return 'reachable';
    }));
  }

  return results;
}

async function emailIfBroken(results: CheckResult[]): Promise<void> {
  const broken = results.filter(r => !r.ok);
  if (broken.length === 0) {
    console.log(`✅ All ${results.length} webhook health checks passed`);
    return;
  }

  console.warn(`⚠️ ${broken.length}/${results.length} webhook health checks failed`);
  if (!resend) {
    console.warn('RESEND_API_KEY not set — cannot send alert email');
    return;
  }

  const body = `
    <h2>🚨 Webhook Health Check — ${broken.length} failing</h2>
    <p>The daily webhook health audit caught problems that could prevent
    customer-facing webhooks from working.</p>
    <h3>Failed checks</h3>
    <ul>
      ${broken.map(r => `<li><strong>${r.name}</strong>: ${r.detail}</li>`).join('')}
    </ul>
    <h3>Passed checks</h3>
    <ul>
      ${results.filter(r => r.ok).map(r => `<li>${r.name}: ${r.detail}</li>`).join('')}
    </ul>
    <hr>
    <p>Cron path: /api/cron/webhook-health-check</p>
  `;

  try {
    await resend.emails.send({
      from: 'Autopilot Alerts <alerts@autopilotamerica.com>',
      to: ['randyvollrath@gmail.com'],
      subject: `🚨 Webhook health check: ${broken.length} failing`,
      html: body,
    });
    console.log('Alert email sent');
  } catch (e: any) {
    console.error('Failed to send alert email:', e.message);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!verifyCronAuth(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = await runChecks();
    await emailIfBroken(results);

    const broken = results.filter(r => !r.ok);
    return res.status(broken.length > 0 ? 500 : 200).json({
      checked: results.length,
      broken: broken.length,
      results,
    });
  } catch (e: any) {
    console.error('Webhook health cron crashed:', e);
    return res.status(500).json({ error: sanitizeErrorMessage(e) });
  }
}
