#!/usr/bin/env tsx
/**
 * Operator visibility into the auto-renewal pipeline.
 *
 * Usage:
 *   tsx scripts/auto-renewal-status.ts
 *
 * Prints:
 *   - Global kill switch state (env)
 *   - Per-user authorization counts
 *   - IL credentials counts (on-file, marked invalid)
 *   - Circuit breaker state per renewal type
 *   - Recent renewal_purchase_consents by status (last 7 days)
 *   - Most recent failures (last 5) with reason
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { supabaseAdmin as typedSupabase } from '../lib/supabase';
import { getCircuitBreaker } from '../lib/renewal-failure-recovery';
import { isAutoRenewalGloballyEnabled } from '../lib/auto-renewal-gate';

const supabase = typedSupabase as any;

function pad(s: string, n: number) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function userCounts() {
  const { count: authedCount } = await supabase
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('auto_renewal_authorized', true);
  const { count: credsCount } = await supabase
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .not('il_pin_encrypted', 'is', null)
    .not('il_registration_id_encrypted', 'is', null);
  const { count: invalidCount } = await supabase
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .not('il_credentials_invalid_at', 'is', null);
  const { count: bothCount } = await supabase
    .from('user_profiles')
    .select('user_id', { count: 'exact', head: true })
    .eq('auto_renewal_authorized', true)
    .not('il_pin_encrypted', 'is', null);
  return { authedCount, credsCount, invalidCount, bothCount };
}

async function consentCounts() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const byStatus: Record<string, number> = {};
  const statuses = ['pending', 'granted', 'declined', 'expired', 'consumed', 'failed'];
  for (const s of statuses) {
    const { count } = await supabase
      .from('renewal_purchase_consents')
      .select('id', { count: 'exact', head: true })
      .eq('status', s)
      .gt('created_at', since);
    byStatus[s] = count ?? 0;
  }
  return byStatus;
}

async function recentFailures() {
  const { data } = await supabase
    .from('renewal_purchase_consents')
    .select('id, renewal_type, status, failure_reason, updated_at')
    .in('status', ['failed'])
    .order('updated_at', { ascending: false })
    .limit(5);
  return data ?? [];
}

async function main() {
  console.log('AUTO-RENEWAL PIPELINE STATUS');
  console.log('============================\n');

  console.log(`Global kill switch (AUTO_RENEWAL_GLOBALLY_ENABLED):  ${isAutoRenewalGloballyEnabled() ? 'ON' : 'OFF (no renewals will run)'}`);
  console.log(`Credentials key (CREDENTIALS_ENCRYPTION_KEY):        ${process.env.CREDENTIALS_ENCRYPTION_KEY ? 'set' : 'MISSING'}`);
  console.log(`Ops card for gov payments (CITY_PAYMENT_CARD_*):     ${process.env.CITY_PAYMENT_CARD_NUMBER && process.env.CITY_PAYMENT_CARD_EXP && process.env.CITY_PAYMENT_CARD_CVV ? 'set' : 'MISSING'}`);
  console.log(`Card billing info (CITY_PAYMENT_BILLING_*):          ${process.env.CITY_PAYMENT_BILLING_ADDRESS1 && process.env.CITY_PAYMENT_BILLING_ZIP ? 'set' : 'MISSING'}`);
  console.log('');

  const u = await userCounts();
  console.log('Users:');
  console.log(`  auto_renewal_authorized = true:                    ${u.authedCount}`);
  console.log(`  IL credentials on file:                            ${u.credsCount}`);
  console.log(`  IL credentials marked invalid:                     ${u.invalidCount}`);
  console.log(`  Both authorized AND credentials on file:           ${u.bothCount}`);
  console.log('');

  console.log('Circuit breakers:');
  for (const t of ['city_sticker', 'license_plate'] as const) {
    const cb = await getCircuitBreaker(t);
    if (!cb) {
      console.log(`  ${pad(t, 16)}  (no row)`);
      continue;
    }
    const status = cb.paused_at ? `PAUSED — ${cb.paused_reason}` : 'closed';
    console.log(`  ${pad(t, 16)}  ${pad(status, 50)}  consecutive=${cb.consecutive_failures}  last_success=${cb.last_success_at || '(none)'}`);
  }
  console.log('');

  const cs = await consentCounts();
  console.log('Consents in last 7 days:');
  for (const [s, n] of Object.entries(cs)) {
    console.log(`  ${pad(s, 10)} ${n}`);
  }
  console.log('');

  const fails = await recentFailures();
  console.log(`Recent failures (most recent ${fails.length}):`);
  for (const f of fails) {
    console.log(`  [${f.updated_at}] ${f.renewal_type} #${(f.id as string).slice(0, 8)} — ${f.failure_reason || '(no reason recorded)'}`);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
