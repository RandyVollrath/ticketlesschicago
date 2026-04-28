#!/usr/bin/env npx tsx
/**
 * Apply supabase/migrations/20260428_iap_referral_code.sql
 * Adds referral_code column to iap_transactions for Rewardful attribution on
 * Apple/Google in-app purchases (which bypass Stripe and rw.js auto-tracking).
 *
 * Run:
 *   node -r dotenv/config node_modules/.bin/tsx scripts/apply-iap-referral-migration.ts dotenv_config_path=.env.local
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error('Missing supabase env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
  const s = createClient(url, key, { auth: { persistSession: false } });

  const file = join(__dirname, '../supabase/migrations/20260428_iap_referral_code.sql');
  const sql = readFileSync(file, 'utf-8');

  console.log('Applying iap_transactions.referral_code migration via exec_sql…');
  const { error } = await (s as any).rpc('exec_sql', { sql_string: sql });
  if (error) {
    console.error('exec_sql failed:', error.message);
    process.exit(1);
  }

  console.log('Verifying column…');
  const { error: vErr } = await s
    .from('iap_transactions')
    .select('referral_code')
    .limit(1);

  if (vErr) {
    console.error('Verification failed:', vErr.message);
    process.exit(1);
  }

  console.log('✅ iap_transactions.referral_code is live');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
