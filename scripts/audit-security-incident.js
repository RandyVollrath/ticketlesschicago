#!/usr/bin/env node
/**
 * Audit script for the Vercel April 2026 incident.
 *
 * Queries Supabase + Stripe for suspicious activity in the incident window
 * (default: last 30 days, override with --since=YYYY-MM-DD).
 *
 * Usage:
 *   node scripts/audit-security-incident.js
 *   node scripts/audit-security-incident.js --since=2026-04-01
 *
 * Env required (reads from .env.local):
 *   SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL
 *   STRIPE_SECRET_KEY
 *
 * Findings are printed grouped by severity. Nothing here writes or mutates.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });
const { createClient } = require('@supabase/supabase-js');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);
const since = args.since
  ? new Date(args.since)
  : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const sinceIso = since.toISOString();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

if (!SUPABASE_URL || !SUPABASE_SRK) {
  console.error('Missing Supabase env vars. Populate .env.local.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SRK, {
  auth: { persistSession: false },
});

const findings = { critical: [], warn: [], info: [] };
const log = (sev, title, detail) =>
  findings[sev].push({ title, detail });

async function checkNewAdmins() {
  const { data, error } = await sb
    .from('user_profiles')
    .select('user_id, email, created_at, role, is_paid, has_contesting')
    .gte('created_at', sinceIso)
    .or('role.eq.admin,has_contesting.eq.true');
  if (error) return log('warn', 'user_profiles query failed', error.message);
  if (!data?.length) return log('info', 'No new admin/contesting users', `Since ${sinceIso}`);
  log(
    'critical',
    `${data.length} new users with role=admin or has_contesting since ${sinceIso}`,
    data.map((u) => `${u.email || u.user_id} (role=${u.role}, contesting=${u.has_contesting}, created=${u.created_at})`).join('\n  ')
  );
}

async function checkCompGrants() {
  const { data, error } = await sb
    .from('audit_logs')
    .select('created_at, user_id, admin_user_id, action_type, action_details, ip_address')
    .gte('created_at', sinceIso)
    .eq('action_type', 'comp_access_granted');
  if (error) return log('warn', 'audit_logs query failed', error.message);
  if (!data?.length) return log('info', 'No comp_access_granted rows in window', '');
  log(
    data.length > 5 ? 'critical' : 'warn',
    `${data.length} comp_access_granted audits in window`,
    data.map((r) => `${r.created_at}  user=${r.user_id}  admin=${r.admin_user_id}  ip=${r.ip_address}  details=${JSON.stringify(r.action_details || {})}`).join('\n  ')
  );
}

async function checkAllAuditActions() {
  const { data, error } = await sb
    .from('audit_logs')
    .select('action_type')
    .gte('created_at', sinceIso);
  if (error) return log('warn', 'audit_logs aggregate query failed', error.message);
  const counts = {};
  data.forEach((r) => (counts[r.action_type] = (counts[r.action_type] || 0) + 1));
  log(
    'info',
    `${data.length} audit_logs entries in window`,
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}: ${n}`).join('\n  ')
  );
}

async function checkUnusualPaidFlips() {
  // is_paid set without a matching Stripe customer/subscription hint in metadata
  const { data, error } = await sb
    .from('user_profiles')
    .select('user_id, email, is_paid, stripe_customer_id, updated_at')
    .eq('is_paid', true)
    .gte('updated_at', sinceIso)
    .is('stripe_customer_id', null);
  if (error) return log('warn', 'paid-without-stripe query failed', error.message);
  if (!data?.length) return log('info', 'No is_paid=true rows lacking stripe_customer_id', '');
  log(
    'critical',
    `${data.length} users flipped is_paid=true in window without stripe_customer_id`,
    data.map((u) => `${u.email || u.user_id}  updated=${u.updated_at}`).join('\n  ')
  );
}

async function checkAdminActions() {
  const { data, error } = await sb
    .from('audit_logs')
    .select('created_at, user_id, admin_user_id, action_type, entity_type, ip_address')
    .gte('created_at', sinceIso)
    .not('admin_user_id', 'is', null);
  if (error) return log('warn', 'audit_logs admin-action query failed', error.message);
  if (!data?.length) return log('info', 'No admin_user_id actions in audit_logs', '');
  const byAdmin = {};
  data.forEach((r) => (byAdmin[r.admin_user_id] = (byAdmin[r.admin_user_id] || 0) + 1));
  const unique = Object.keys(byAdmin).length;
  log(
    unique > 1 ? 'critical' : 'warn',
    `${data.length} admin actions in window from ${unique} unique admin_user_id(s)`,
    Object.entries(byAdmin).map(([a, n]) => `admin=${a}  count=${n}`).join('\n  ') +
      '\n  Sample IPs: ' +
      [...new Set(data.map((r) => r.ip_address).filter(Boolean))].slice(0, 10).join(', ')
  );
}

async function checkStripeKeys() {
  if (!STRIPE_KEY) return log('warn', 'STRIPE_SECRET_KEY not set — skipping Stripe checks', '');
  const Stripe = require('stripe');
  const stripe = new Stripe(STRIPE_KEY);

  // Stripe doesn't expose API-key creation events via API directly,
  // but we can check events for unexpected types + recent webhook endpoints.
  const sinceUnix = Math.floor(since.getTime() / 1000);

  try {
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
    const newOnes = endpoints.data.filter((e) => e.created >= sinceUnix);
    if (newOnes.length) {
      log(
        'critical',
        `${newOnes.length} webhook endpoints created since window`,
        newOnes.map((e) => `${new Date(e.created * 1000).toISOString()}  ${e.url}  status=${e.status}`).join('\n  ')
      );
    } else {
      log('info', 'No new Stripe webhook endpoints', `${endpoints.data.length} total`);
    }
  } catch (e) {
    log('warn', 'Stripe webhookEndpoints.list failed', e.message);
  }

  try {
    // Sweep for unusual event types
    const events = await stripe.events.list({
      created: { gte: sinceUnix },
      limit: 100,
    });
    const typeCount = {};
    events.data.forEach((ev) => (typeCount[ev.type] = (typeCount[ev.type] || 0) + 1));
    log(
      'info',
      `${events.data.length} Stripe events in window (sample)`,
      Object.entries(typeCount).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}: ${n}`).join('\n  ')
    );

    // Flag any account.* or api_key.* events (these indicate account-level tampering)
    const suspicious = events.data.filter((ev) =>
      /^(account|api_key|setup_intent\.created|customer\.deleted)/.test(ev.type)
    );
    if (suspicious.length) {
      log(
        'critical',
        `${suspicious.length} account/api_key-level Stripe events`,
        suspicious.map((ev) => `${new Date(ev.created * 1000).toISOString()}  ${ev.type}  ${ev.id}`).join('\n  ')
      );
    }
  } catch (e) {
    log('warn', 'Stripe events.list failed', e.message);
  }

  try {
    // Charges to unusual destinations / refund storms
    const refunds = await stripe.refunds.list({
      created: { gte: sinceUnix },
      limit: 100,
    });
    if (refunds.data.length > 5) {
      log(
        'warn',
        `${refunds.data.length} refunds in window — unusual?`,
        refunds.data.slice(0, 10).map((r) => `${new Date(r.created * 1000).toISOString()}  $${(r.amount / 100).toFixed(2)}  reason=${r.reason}`).join('\n  ')
      );
    }
  } catch (e) {
    log('warn', 'Stripe refunds.list failed', e.message);
  }
}

async function main() {
  console.log(`\n=== Security audit — since ${sinceIso} ===\n`);
  await Promise.all([
    checkNewAdmins(),
    checkCompGrants(),
    checkAllAuditActions(),
    checkUnusualPaidFlips(),
    checkAdminActions(),
    checkStripeKeys(),
  ]);

  for (const sev of ['critical', 'warn', 'info']) {
    const items = findings[sev];
    if (!items.length) continue;
    const header = { critical: 'CRITICAL', warn: 'WARN', info: 'info' }[sev];
    console.log(`\n--- ${header} (${items.length}) ---`);
    items.forEach(({ title, detail }) => {
      console.log(`\n• ${title}`);
      if (detail) console.log(`  ${detail}`);
    });
  }

  const exitCode = findings.critical.length ? 1 : 0;
  console.log(`\nDone. ${findings.critical.length} critical, ${findings.warn.length} warnings.`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error('Audit crashed:', e);
  process.exit(2);
});
