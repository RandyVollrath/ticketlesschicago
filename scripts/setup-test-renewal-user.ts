#!/usr/bin/env tsx
/**
 * Set up an existing user with everything needed to test the auto-renewal
 * pipeline end-to-end. SAFE — only writes to a single email's row; never
 * touches other users.
 *
 * Usage:
 *   tsx scripts/setup-test-renewal-user.ts <email> \
 *     --plate ABC1234 --vin 1HGBH41JXMN109186 --last-name Smith \
 *     --il-reg-id 1234567890 --il-pin 5678 \
 *     [--city-expiry 2026-07-15] [--plate-expiry 2026-08-01]
 *
 * What it does:
 *   - Looks up the auth user by email; refuses if not found
 *   - Writes plate, VIN, last name, expirations to user_profiles
 *   - Encrypts Reg ID + PIN and stores in user_profiles
 *   - Sets auto_renewal_authorized = true, with attribution
 *   - Idempotent (re-runnable to refresh state)
 *
 * Requires CREDENTIALS_ENCRYPTION_KEY env var to encrypt the IL creds.
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { createClient } from '@supabase/supabase-js';
import { encryptCredential } from '../lib/credentials-vault';

interface Args {
  email: string;
  plate?: string;
  vin?: string;
  lastName?: string;
  ilRegId?: string;
  ilPin?: string;
  cityExpiry?: string;
  plateExpiry?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { email: '', dryRun: false };
  const pos: string[] = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plate') out.plate = argv[++i];
    else if (a === '--vin') out.vin = argv[++i];
    else if (a === '--last-name') out.lastName = argv[++i];
    else if (a === '--il-reg-id') out.ilRegId = argv[++i];
    else if (a === '--il-pin') out.ilPin = argv[++i];
    else if (a === '--city-expiry') out.cityExpiry = argv[++i];
    else if (a === '--plate-expiry') out.plateExpiry = argv[++i];
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a}`);
      process.exit(2);
    } else pos.push(a);
  }
  if (pos.length !== 1) {
    console.error('Usage: tsx scripts/setup-test-renewal-user.ts <email> [flags]');
    process.exit(2);
  }
  out.email = pos[0];
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  if ((args.ilRegId || args.ilPin) && !process.env.CREDENTIALS_ENCRYPTION_KEY) {
    console.error('CREDENTIALS_ENCRYPTION_KEY required to encrypt IL credentials');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  // Find auth user
  const { data: list, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.error('listUsers failed:', listErr.message);
    process.exit(1);
  }
  const user = list.users.find((u) => u.email?.toLowerCase() === args.email.toLowerCase());
  if (!user) {
    console.error(`No auth user with email ${args.email}`);
    process.exit(1);
  }

  const updates: Record<string, any> = {
    auto_renewal_authorized: true,
    auto_renewal_authorized_at: new Date().toISOString(),
    auto_renewal_authorized_by: process.env.ADMIN_EMAIL || 'setup-test-renewal-user',
    auto_renewal_authorization_reason: 'internal QA',
  };
  if (args.plate) updates.license_plate = args.plate.toUpperCase();
  if (args.vin) updates.vin = args.vin.toUpperCase();
  if (args.lastName) updates.last_name = args.lastName;
  if (args.cityExpiry) updates.city_sticker_expiry = args.cityExpiry;
  if (args.plateExpiry) updates.license_plate_expiry = args.plateExpiry;
  if (args.ilRegId) updates.il_registration_id_encrypted = encryptCredential(args.ilRegId);
  if (args.ilPin) updates.il_pin_encrypted = encryptCredential(args.ilPin);
  if (args.ilRegId || args.ilPin) {
    updates.il_credentials_updated_at = new Date().toISOString();
    updates.il_credentials_invalid_at = null;
  }

  console.log(`User: ${args.email}  (${user.id})`);
  console.log('Updates:');
  for (const [k, v] of Object.entries(updates)) {
    const shown = k.endsWith('_encrypted') ? `<encrypted ${(v as string).length} chars>` : String(v);
    console.log(`  ${k}: ${shown}`);
  }
  if (args.dryRun) {
    console.log('\n(dry-run — no write performed)');
    return;
  }

  const { error: updErr } = await supabase
    .from('user_profiles')
    .update(updates as any)
    .eq('user_id', user.id);
  if (updErr) {
    console.error('update failed:', updErr.message);
    process.exit(1);
  }
  console.log('\n✅ Test user configured for auto-renewal pipeline');
  console.log('Next steps:');
  console.log(`  1. Set AUTO_RENEWAL_GLOBALLY_ENABLED=true in Vercel`);
  console.log(`  2. Trigger the consent cron manually:`);
  console.log(`     (hit /api/cron/create-authorized-renewal-consents with the Bearer token matching CRON_SECRET in Vercel env)`);
  console.log(`  3. Check the user's email for the authorize link`);
  console.log(`  4. Click the link, click Authorize, then wait <30min for orchestration cron`);
  console.log(`  5. For dry-run testing, ALSO set RENEWAL_DRY_RUN=true so no real Stripe charge or gov hit`);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
