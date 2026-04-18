#!/usr/bin/env node
/**
 * Wipe a test user completely so the email can be reused for a fresh signup.
 * Removes the auth.users row, every public-table row keyed by user_id, and
 * every Stripe customer (with active subscriptions cancelled) for that email.
 *
 * Usage:
 *   node scripts/nuke-test-user.js --email user@example.com           # dry run
 *   node scripts/nuke-test-user.js --email user@example.com --commit  # actually delete
 *   node scripts/nuke-test-user.js --orphans                          # list auth.users with no user_profiles
 *
 * NEVER deletes randyvollrath@gmail.com (the live owner account) — hard guard.
 */

const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
require('dotenv').config({ path: '.env.local' });

const PROTECTED_EMAILS = new Set(['randyvollrath@gmail.com']);

// Tables to scan/delete by user_id. Order matters where there are FKs.
const USER_TABLES = [
  'autopilot_letters',
  'autopilot_events',
  'autopilot_settings',
  'autopilot_subscriptions',
  'autopilot_membership',
  'monitored_plates',
  'detected_tickets',
  'vehicle_reminders',
  'parking_diagnostics',
  'user_parked_vehicles',
  'parking_call_alerts',
  'push_tokens',
  'audit_logs',
  'user_profiles',
];

const args = process.argv.slice(2);
const getArg = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(
  process.env.STRIPE_SECRET_KEY
);

async function findOrphans() {
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 500 });
  const { data: profiles } = await sb.from('user_profiles').select('user_id');
  const have = new Set(profiles.map((p) => p.user_id));
  return users.filter((u) => !have.has(u.id));
}

async function nukeByEmail(email, commit) {
  const lc = email.trim().toLowerCase();
  if (PROTECTED_EMAILS.has(lc)) {
    console.error(`REFUSED: ${lc} is on the protected list.`);
    process.exit(1);
  }

  console.log(`\n=== ${commit ? 'COMMIT' : 'DRY-RUN'}: ${lc} ===`);

  // 1. auth.users
  const { data: { users } } = await sb.auth.admin.listUsers({ perPage: 500 });
  const matches = users.filter((u) => (u.email || '').toLowerCase() === lc);
  console.log(`auth.users: ${matches.length} match`);

  for (const u of matches) {
    console.log(`  user_id=${u.id} created=${u.created_at}`);
    for (const t of USER_TABLES) {
      const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true }).eq('user_id', u.id);
      if (error) continue;
      if (count > 0) {
        console.log(`    ${t}: ${count} rows`);
        if (commit) {
          const { error: delErr } = await sb.from(t).delete().eq('user_id', u.id);
          if (delErr) console.log(`      ! delete failed: ${delErr.message}`);
        }
      }
    }
    if (commit) {
      const { error: authErr } = await sb.auth.admin.deleteUser(u.id);
      if (authErr) console.log(`    ! auth delete failed: ${authErr.message}`);
      else console.log(`    auth.users row deleted`);
    }
  }

  // 2. Stripe
  const cust = await stripe.customers.list({ email: lc, limit: 10 });
  console.log(`stripe.customers: ${cust.data.length} match`);
  for (const c of cust.data) {
    console.log(`  ${c.id} created=${new Date(c.created * 1000).toISOString()}`);
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'all', limit: 10 });
    for (const s of subs.data) {
      console.log(`    sub ${s.id} status=${s.status}`);
      if (commit && (s.status === 'active' || s.status === 'trialing' || s.status === 'past_due')) {
        await stripe.subscriptions.cancel(s.id);
        console.log(`      cancelled`);
      }
    }
    if (commit) {
      await stripe.customers.del(c.id);
      console.log(`    deleted`);
    }
  }
}

(async () => {
  if (args.includes('--orphans')) {
    const orphans = await findOrphans();
    console.log(`Total orphan auth.users (no user_profiles): ${orphans.length}\n`);
    for (const o of orphans) console.log(`  ${o.id}  ${o.email}  ${o.created_at}`);
    return;
  }

  const email = getArg('--email');
  if (!email) {
    console.log('Usage: node scripts/nuke-test-user.js --email user@example.com [--commit]');
    console.log('       node scripts/nuke-test-user.js --orphans');
    process.exit(1);
  }
  const commit = args.includes('--commit');
  await nukeByEmail(email, commit);
  if (!commit) console.log('\n(Dry run. Re-run with --commit to actually delete.)');
})();
