#!/usr/bin/env node
/**
 * Grant comp (free) paid access to a user.
 *
 * Usage:
 *   node scripts/grant-comp-access.js <email> [--reason "..."] [--create] [--dry-run]
 *
 * Default behavior:
 *   - If the user already exists in auth.users, flips user_profiles flags to paid.
 *   - If the user does NOT exist, errors out unless --create is passed.
 *
 * With --create:
 *   - Creates an auth user (email confirmed), seeds a user_profiles row, sets flags,
 *     and prints a magic-link URL the user can click to sign in.
 *
 * Flags flipped:
 *   is_paid = true
 *   has_contesting = true   (mobile App.tsx:125 gates on EITHER flag)
 *
 * An audit_logs row is inserted with action_type='comp_access_granted' for auditability.
 *
 * Why this exists: CLAUDE.md says is_paid should only be set via the Stripe
 * webhook. That rule is to prevent accidental defaults on signup. Owner-authorized
 * comps for friends/family/testers are an explicit, audited exception.
 */

const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

function parseArgs(argv) {
  // sendEmail defaults to true when --create is set (new users need a way to sign in);
  // suppress with --no-email.
  const out = { create: false, dryRun: false, sendEmail: null };
  const positional = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reason') out.reason = argv[++i];
    else if (a === '--create') out.create = true;
    else if (a === '--no-email') out.sendEmail = false;
    else if (a === '--send-email') out.sendEmail = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-h' || a === '--help') out.help = true;
    else if (!a.startsWith('--')) positional.push(a);
  }
  if (out.sendEmail === null) out.sendEmail = out.create;
  out.email = positional[0];
  return out;
}

function printHelp() {
  const help = [
    'Usage: node scripts/grant-comp-access.js <email> [--reason "..."] [--create] [--dry-run]',
    '',
    '  --create    Create the auth user if they have not signed up yet',
    '  --reason    Note saved to audit_logs for future reference',
    '  --dry-run   Show what would happen without writing anything',
  ].join('\n');
  console.log(help);
}

async function findAuthUser(email) {
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < perPage) return null;
    page += 1;
  }
}

async function createAuthUser(email, { sendInvite }) {
  // inviteUserByEmail creates the user AND emails them via Supabase's "Invite user"
  // template — the email contains a link that signs them in and lets them set a password.
  // If sendInvite is false, fall back to createUser (no email).
  if (sendInvite) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://autopilotamerica.com',
    });
    if (error) throw new Error(`inviteUserByEmail failed: ${error.message}`);
    return data.user;
  }
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser failed: ${error.message}`);
  return data.user;
}

async function upsertProfile(user, email) {
  const { data: existing, error: fetchErr } = await supabase
    .from('user_profiles')
    .select('user_id,email,is_paid,has_contesting')
    .eq('user_id', user.id)
    .maybeSingle();
  if (fetchErr) throw new Error(`profile lookup failed: ${fetchErr.message}`);

  if (existing) {
    const { error } = await supabase
      .from('user_profiles')
      .update({ is_paid: true, has_contesting: true, email: existing.email || email })
      .eq('user_id', user.id);
    if (error) throw new Error(`profile update failed: ${error.message}`);
    return { action: 'updated', before: existing };
  }

  const { error } = await supabase
    .from('user_profiles')
    .insert({ user_id: user.id, email, is_paid: true, has_contesting: true });
  if (error) throw new Error(`profile insert failed: ${error.message}`);
  return { action: 'inserted', before: null };
}

async function generateMagicLink(email) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (error) throw new Error(`magic link failed: ${error.message}`);
  return data.properties?.action_link || null;
}

async function writeAuditLog({ userId, email, reason, action, createdAccount }) {
  const { error } = await supabase.from('audit_logs').insert({
    user_id: userId,
    action_type: 'comp_access_granted',
    entity_type: 'user_profile',
    entity_id: userId,
    action_details: {
      email,
      reason: reason || null,
      profile_action: action,
      created_account: createdAccount,
      granted_by: 'grant-comp-access.js',
      granted_at: new Date().toISOString(),
    },
    status: 'success',
  });
  if (error) console.warn(`audit_logs insert failed (non-fatal): ${error.message}`);
}

(async () => {
  const args = parseArgs(process.argv);
  if (args.help || !args.email) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const email = args.email.trim().toLowerCase();
  console.log(`-> target: ${email}${args.dryRun ? '  (DRY RUN)' : ''}`);

  let user = await findAuthUser(email);
  let createdAccount = false;

  if (!user) {
    if (!args.create) {
      console.error(`no auth user for ${email} — re-run with --create to pre-provision them`);
      process.exit(2);
    }
    if (args.dryRun) {
      console.log(`would: ${args.sendEmail ? 'invite (create + email)' : 'create'} auth user, upsert user_profiles row, flip is_paid+has_contesting`);
      process.exit(0);
    }
    console.log(`-> ${args.sendEmail ? 'inviting' : 'creating'} auth user...`);
    user = await createAuthUser(email, { sendInvite: args.sendEmail });
    createdAccount = true;
    console.log(`   created user_id=${user.id}${args.sendEmail ? ' (invite email sent)' : ''}`);
  } else {
    console.log(`-> found auth user: ${user.id} (created ${user.created_at})`);
  }

  if (args.dryRun) {
    console.log(`would: flip is_paid=true, has_contesting=true on user_profiles (user_id=${user.id})`);
    process.exit(0);
  }

  const { action, before } = await upsertProfile(user, email);
  if (before) {
    console.log(`-> profile ${action}: was is_paid=${before.is_paid}, has_contesting=${before.has_contesting} -> now both true`);
  } else {
    console.log(`-> profile ${action}: is_paid=true, has_contesting=true`);
  }

  await writeAuditLog({
    userId: user.id,
    email,
    reason: args.reason,
    action,
    createdAccount,
  });
  console.log(`-> audit log written`);

  if (createdAccount && !args.sendEmail) {
    // No invite email was sent — hand the caller a magic link to share manually.
    const link = await generateMagicLink(email);
    if (link) {
      console.log('');
      console.log(`Magic link for ${email} (expires per Supabase config):`);
      console.log(link);
      console.log('');
      console.log(`Send this link to the user — clicking it signs them in on the web app.`);
    }
  } else if (createdAccount && args.sendEmail) {
    console.log(`-> invite email delivered via Supabase to ${email}`);
  }

  console.log(`\nDone. ${email} now has paid access.`);
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
