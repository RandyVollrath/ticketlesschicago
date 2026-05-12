#!/usr/bin/env tsx
/**
 * Grant or revoke auto-renewal authorization for a user.
 *
 * Usage:
 *   tsx scripts/grant-auto-renewal.ts <email> --reason "..." [--by <admin-email>] [--revoke] [--dry-run]
 *
 * Default behavior:
 *   - Looks up auth user by email
 *   - Sets user_profiles.auto_renewal_authorized = TRUE (or FALSE with --revoke)
 *   - Writes timestamp + admin attribution to user_profiles
 *
 * Even after grant, the global kill switch AUTO_RENEWAL_GLOBALLY_ENABLED must
 * be TRUE in the environment for any automation to actually run. Granting is
 * per-user opt-in; the env flag is the all-or-nothing kill switch.
 *
 * Required: user must have il_registration_id_encrypted + il_pin_encrypted
 * set (collected via the settings UI) — script warns if missing.
 */

import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

interface Args {
  email: string;
  reason?: string;
  by?: string;
  revoke: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { email: '', revoke: false, dryRun: false };
  const pos: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--reason') out.reason = argv[++i];
    else if (a === '--by') out.by = argv[++i];
    else if (a === '--revoke') out.revoke = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else pos.push(a);
  }
  if (pos.length !== 1) {
    console.error('Usage: tsx scripts/grant-auto-renewal.ts <email> --reason "..." [--by <admin>] [--revoke] [--dry-run]');
    process.exit(2);
  }
  out.email = pos[0];
  if (!out.revoke && !out.reason) {
    console.error('--reason is required when granting (omit only when --revoke)');
    process.exit(2);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const admin = args.by || process.env.ADMIN_EMAIL || 'unknown-admin';

  // Find auth user
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.error('listUsers failed:', listErr.message);
    process.exit(1);
  }
  const u = list.users.find((x) => x.email?.toLowerCase() === args.email.toLowerCase());
  if (!u) {
    console.error(`No auth user with email ${args.email}`);
    process.exit(1);
  }

  const { data: profile, error: profErr } = await supabase
    .from('user_profiles')
    .select('user_id, il_pin_encrypted, il_registration_id_encrypted, auto_renewal_authorized, auto_renewal_authorized_at, auto_renewal_authorized_by' as any)
    .eq('user_id', u.id)
    .maybeSingle();
  if (profErr) {
    console.error('user_profiles lookup failed:', profErr.message);
    process.exit(1);
  }
  if (!profile) {
    console.error(`user_profiles row not found for ${args.email}`);
    process.exit(1);
  }
  const p = profile as any;

  console.log(`User: ${args.email}`);
  console.log(`  user_id: ${u.id}`);
  console.log(`  current authorized: ${p.auto_renewal_authorized}`);
  console.log(`  current authorized_at: ${p.auto_renewal_authorized_at || '(none)'}`);
  console.log(`  current authorized_by: ${p.auto_renewal_authorized_by || '(none)'}`);
  console.log(`  IL creds on file: ${Boolean(p.il_pin_encrypted && p.il_registration_id_encrypted)}`);

  if (!args.revoke && !(p.il_pin_encrypted && p.il_registration_id_encrypted)) {
    console.warn('\n⚠️  User has not entered IL Registration ID + PIN yet.');
    console.warn('   Grant will still be recorded, but no renewal can run until they add credentials in Settings.');
  }

  const updates = args.revoke
    ? {
        auto_renewal_authorized: false,
        auto_renewal_authorized_at: null,
        auto_renewal_authorized_by: null,
        auto_renewal_authorization_reason: null,
      }
    : {
        auto_renewal_authorized: true,
        auto_renewal_authorized_at: new Date().toISOString(),
        auto_renewal_authorized_by: admin,
        auto_renewal_authorization_reason: args.reason || null,
      };

  console.log(`\n${args.dryRun ? 'WOULD APPLY' : 'APPLYING'}:`, updates);
  if (args.dryRun) return;

  const { error: updErr } = await supabase
    .from('user_profiles')
    .update(updates as any)
    .eq('user_id', u.id);
  if (updErr) {
    console.error('update failed:', updErr.message);
    process.exit(1);
  }

  // Audit log to existing audit_logs table if it exists; ignore if not.
  await supabase.from('audit_logs').insert({
    actor_email: admin,
    actor_type: 'admin',
    action: args.revoke ? 'auto_renewal_revoke' : 'auto_renewal_grant',
    target_user_id: u.id,
    target_email: args.email,
    metadata: { reason: args.reason || null },
  } as any).then(({ error }) => {
    if (error) console.warn(`(audit log insert skipped: ${error.message})`);
  });

  console.log(`✅ ${args.revoke ? 'Revoked' : 'Granted'} for ${args.email}`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
