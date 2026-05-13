#!/usr/bin/env tsx
/**
 * Local end-to-end dry-run of the worker pipeline against the qa-bot.
 *
 *   1. Set qa-bot's user_profiles to authorized + minimal vehicle data
 *      + fake encrypted IL creds.
 *   2. Insert a granted consent (license_plate type) directly via the
 *      admin client (skips the user-facing authorize page round-trip).
 *   3. Invoke scripts/run-renewal-queue.ts logic via lib/run-granted-consents
 *      with AUTO_RENEWAL_GLOBALLY_ENABLED=true and RENEWAL_DRY_RUN=true.
 *   4. Print the outcome (expecting failure at invalid_credentials because
 *      IL SOS rejects fake PINs — that's the test of the detection path).
 *   5. Clean up: revert user_profiles + delete consent.
 *
 * This proves: worker claim, gate, dry-run charge skip, stealth Playwright
 * against IL SOS, invalid-credentials detection, consent state machine,
 * circuit breaker exclusion. NO real money moves; NO real renewal happens.
 *
 * Required env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *               NEXT_PUBLIC_SUPABASE_ANON_KEY, CREDENTIALS_ENCRYPTION_KEY.
 */

import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

// Force pipeline-on + dry-run in-process so we never need to flip the real
// Vercel/worker-box env vars for this script.
process.env.AUTO_RENEWAL_GLOBALLY_ENABLED = 'true';
process.env.RENEWAL_DRY_RUN = 'true';

const QA_BOT_ID = '7d1adabb-f9f5-41ec-9075-5f7cb311a822';

import { createClient } from '@supabase/supabase-js';
import { encryptCredential } from '../lib/credentials-vault';
import { claimGrantedConsent, processConsent } from '../lib/run-granted-consents';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } }) as any;

async function snapshotProfile(userId: string) {
  const { data } = await supabase
    .from('user_profiles')
    .select(
      'license_plate, license_state, vin, last_name, auto_renewal_authorized, auto_renewal_authorized_at, auto_renewal_authorized_by, il_registration_id_encrypted, il_pin_encrypted, il_credentials_updated_at, il_credentials_invalid_at',
    )
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

async function configureBot() {
  const updates = {
    auto_renewal_authorized: true,
    auto_renewal_authorized_at: new Date().toISOString(),
    auto_renewal_authorized_by: 'e2e-worker-dryrun',
    auto_renewal_authorization_reason: 'local e2e dry-run smoke',
    license_plate: 'TESTABC',
    license_state: 'IL',
    vin: '1HGBH41JXMN109186',
    last_name: 'QA',
    il_registration_id_encrypted: encryptCredential('99999999999'),
    il_pin_encrypted: encryptCredential('0000'),
    il_credentials_updated_at: new Date().toISOString(),
    il_credentials_invalid_at: null,
  };
  await supabase.from('user_profiles').update(updates).eq('user_id', QA_BOT_ID);
}

async function restoreBot(snapshot: any) {
  if (!snapshot) return;
  await supabase.from('user_profiles').update(snapshot).eq('user_id', QA_BOT_ID);
}

async function createGrantedConsent(): Promise<string> {
  const token = require('crypto').randomBytes(24).toString('base64url');
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('renewal_purchase_consents')
    .insert({
      user_id: QA_BOT_ID,
      renewal_type: 'license_plate',
      license_plate: 'TESTABC',
      license_state: 'IL',
      gov_amount_cents: 15100,
      service_fee_cents: 0,
      total_amount_cents: 15100,
      consent_token: token,
      status: 'granted',
      expires_at: expires,
      granted_at: now,
      granted_ip: '127.0.0.1',
      granted_user_agent: 'e2e-script',
    })
    .select('id')
    .single();
  if (error) throw new Error(`createGrantedConsent: ${error.message}`);
  return (data as any).id as string;
}

async function deleteConsent(id: string) {
  await supabase.from('renewal_purchase_consents').delete().eq('id', id);
}

async function main() {
  console.log('snapshotting qa-bot profile state...');
  const snapshot = await snapshotProfile(QA_BOT_ID);
  if (!snapshot) {
    console.error('qa-bot user_profiles row missing — aborting');
    process.exit(1);
  }

  let consentId: string | null = null;
  try {
    console.log('configuring qa-bot for dry-run...');
    await configureBot();

    console.log('creating a granted license_plate consent...');
    consentId = await createGrantedConsent();
    console.log(`  consent id: ${consentId}`);

    console.log('\nclaiming via worker logic...');
    const consent = await claimGrantedConsent('e2e-worker-dryrun');
    if (!consent) {
      console.error('FAIL: claimGrantedConsent returned null (was the consent we just inserted not picked up?)');
      return;
    }
    if (consent.id !== consentId) {
      console.error(`FAIL: claimed a DIFFERENT consent (${consent.id}) than the one we created (${consentId}). Aborting to avoid touching unrelated work.`);
      return;
    }
    console.log(`  claimed: ${consent.id}`);

    console.log('\nprocessing (dry-run; will hit real IL SOS with fake creds)...');
    const start = Date.now();
    const outcome = await processConsent(consent);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n  outcome (${elapsed}s):`, outcome);

    // Sanity: fetch the consent post-processing
    const { data: after } = await supabase
      .from('renewal_purchase_consents')
      .select('status, failure_reason, consumed_at')
      .eq('id', consentId)
      .single();
    console.log('\n  consent state after:', after);
  } finally {
    if (consentId) {
      console.log('\ncleanup: deleting test consent...');
      await deleteConsent(consentId);
    }
    console.log('cleanup: restoring qa-bot profile snapshot...');
    await restoreBot({
      license_plate: snapshot.license_plate,
      license_state: snapshot.license_state,
      vin: snapshot.vin,
      last_name: snapshot.last_name,
      auto_renewal_authorized: snapshot.auto_renewal_authorized,
      auto_renewal_authorized_at: snapshot.auto_renewal_authorized_at,
      auto_renewal_authorized_by: snapshot.auto_renewal_authorized_by,
      il_registration_id_encrypted: snapshot.il_registration_id_encrypted,
      il_pin_encrypted: snapshot.il_pin_encrypted,
      il_credentials_updated_at: snapshot.il_credentials_updated_at,
      il_credentials_invalid_at: snapshot.il_credentials_invalid_at,
    });
    console.log('done.');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
