#!/usr/bin/env tsx
/**
 * End-to-end smoke test of the auto-renewal pipeline's NON-gov-site layers.
 *
 * Covers:
 *   - lib/credentials-vault: encrypt+decrypt round-trip + tamper detection
 *   - lib/auto-renewal-gate: rejects when global flag off, rejects when
 *     per-user flag off, allows when both on
 *   - lib/renewal-consent: create/grant/decline/consume + findActiveGranted
 *   - lib/renewal-failure-recovery: increments, trips, resets
 *
 * Does NOT cover the actual Playwright gov-site walks — those need real
 * Reg ID + PIN and a live renewal-window plate, run via:
 *   scripts/probe-ilsos-renewal-walk.ts   (IL plate)
 *   scripts/smoke-test-citysticker-walk.ts (city, TODO)
 *
 * Required env:
 *   TEST_USER_ID                — auth.users id to use for gate + consent tests
 *   CREDENTIALS_ENCRYPTION_KEY  — must be set (vault depends on it)
 *
 * Safe to run repeatedly — cleans up its own DB rows on success and failure.
 */

import path from 'path';
import { randomBytes } from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

import { encryptCredential, decryptCredential } from '../lib/credentials-vault';
import {
  checkAutoRenewalAllowed,
  isAutoRenewalGloballyEnabled,
} from '../lib/auto-renewal-gate';
import {
  createConsentRequest,
  getConsentByToken,
  grantConsent,
  declineConsent,
  findActiveGrantedConsent,
  consumeConsent,
} from '../lib/renewal-consent';
import {
  getCircuitBreaker,
  recordRenewalFailure,
  recordRenewalSuccess,
  resetCircuitBreaker,
  isCircuitTripped,
  CIRCUIT_BREAKER_THRESHOLD,
} from '../lib/renewal-failure-recovery';
import { supabaseAdmin as typedSupabase } from '../lib/supabase';

const supabaseAdmin = typedSupabase as any;

const TEST_USER_ID = process.env.TEST_USER_ID;
if (!TEST_USER_ID) {
  console.error('Set TEST_USER_ID to an auth.users row id (with a user_profiles row).');
  process.exit(2);
}
if (!process.env.CREDENTIALS_ENCRYPTION_KEY) {
  console.error('CREDENTIALS_ENCRYPTION_KEY must be set.');
  process.exit(2);
}

let failures = 0;
const createdConsentIds: string[] = [];

function check(cond: any, msg: string) {
  if (cond) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.log(`  ❌ ${msg}`);
    failures++;
  }
}

async function testVault() {
  console.log('\n# credentials-vault');
  const samples = ['1234', 'A1B2C3', '9999999999'];
  for (const s of samples) {
    const ct = encryptCredential(s);
    check(ct.split('.').length === 3, `format(${s}): iv.tag.ct`);
    check(decryptCredential(ct) === s, `round-trip(${s})`);
  }
  // Tamper
  const ct = encryptCredential('1234');
  const [iv, tag, body] = ct.split('.');
  const flipped = Buffer.from(body, 'base64');
  flipped[0] ^= 0xff;
  let tampered = false;
  try {
    decryptCredential(`${iv}.${tag}.${flipped.toString('base64')}`);
  } catch {
    tampered = true;
  }
  check(tampered, 'tampered ciphertext rejected');
}

async function testGateGlobal() {
  console.log('\n# auto-renewal-gate: global flag');
  // We assume current env has global flag off OR on — read it and check
  // the gate matches.
  const globalOn = isAutoRenewalGloballyEnabled();
  console.log(`  (global flag is currently: ${globalOn ? 'ON' : 'OFF'})`);
  const check1 = await checkAutoRenewalAllowed(TEST_USER_ID!);
  if (!globalOn) {
    check(!check1.allowed && /global/i.test(check1.reason || ''), 'gate denies when global flag off');
  }
}

async function testGatePerUser() {
  console.log('\n# auto-renewal-gate: per-user flag');
  // Force flag false, check denial. Restore at the end.
  const { data: before } = await supabaseAdmin
    .from('user_profiles')
    .select('auto_renewal_authorized, auto_renewal_authorized_at, auto_renewal_authorized_by, auto_renewal_authorization_reason')
    .eq('user_id', TEST_USER_ID)
    .maybeSingle();

  await supabaseAdmin
    .from('user_profiles')
    .update({ auto_renewal_authorized: false })
    .eq('user_id', TEST_USER_ID);

  // Force global flag ON in-process so we can isolate the per-user check.
  // (assertAutoRenewalAllowed reads env every call; flipping it here only
  // affects this process.)
  process.env.AUTO_RENEWAL_GLOBALLY_ENABLED = 'true';

  const r1 = await checkAutoRenewalAllowed(TEST_USER_ID!);
  check(!r1.allowed && /user not authorized/i.test(r1.reason || ''), 'gate denies when per-user flag false');

  // Flip user flag on, expect allow.
  await supabaseAdmin
    .from('user_profiles')
    .update({ auto_renewal_authorized: true, auto_renewal_authorized_at: new Date().toISOString(), auto_renewal_authorized_by: 'smoke-test' })
    .eq('user_id', TEST_USER_ID);

  const r2 = await checkAutoRenewalAllowed(TEST_USER_ID!);
  check(r2.allowed, 'gate allows when both flags on');

  // Restore prior state
  if (before) {
    await supabaseAdmin
      .from('user_profiles')
      .update({
        auto_renewal_authorized: (before as any).auto_renewal_authorized ?? false,
        auto_renewal_authorized_at: (before as any).auto_renewal_authorized_at ?? null,
        auto_renewal_authorized_by: (before as any).auto_renewal_authorized_by ?? null,
        auto_renewal_authorization_reason: (before as any).auto_renewal_authorization_reason ?? null,
      })
      .eq('user_id', TEST_USER_ID);
  }
}

async function testConsentLifecycle() {
  console.log('\n# renewal-consent: lifecycle');
  // Create + grant
  const c = await createConsentRequest({
    userId: TEST_USER_ID!,
    renewalType: 'city_sticker',
    licensePlate: 'SMOKE' + randomBytes(2).toString('hex').toUpperCase(),
    licenseState: 'IL',
    govAmountCents: 9900,
    serviceFeeCents: 500,
    expiresInDays: 1,
  });
  createdConsentIds.push(c.id);
  check(c.status === 'pending', 'consent created in pending');
  check(c.total_amount_cents === 9900 + 500, 'total_amount_cents = gov + fee');
  check(typeof c.consent_token === 'string' && c.consent_token.length > 16, 'token is opaque');

  const granted = await grantConsent(c.consent_token, { ip: '203.0.113.1', userAgent: 'smoke' });
  check(granted.status === 'granted', 'consent grant transitions to granted');
  check(granted.granted_ip === '203.0.113.1', 'granted_ip stored');

  // findActive should locate it
  const active = await findActiveGrantedConsent(TEST_USER_ID!, 'city_sticker');
  check(active?.id === c.id, 'findActiveGrantedConsent returns latest granted');

  // Consume — success path
  const consumed = await consumeConsent(c.id, { success: true, data: { confirmation_number: 'SMOKE-1' } });
  check(consumed.status === 'consumed', 'consume(success) transitions to consumed');

  // Decline a fresh one
  const c2 = await createConsentRequest({
    userId: TEST_USER_ID!,
    renewalType: 'license_plate',
    govAmountCents: 15100,
    expiresInDays: 1,
  });
  createdConsentIds.push(c2.id);
  const declined = await declineConsent(c2.consent_token);
  check(declined.status === 'declined', 'decline transitions to declined');

  // Reading by token works
  const fetched = await getConsentByToken(c2.consent_token);
  check(fetched?.id === c2.id, 'getConsentByToken returns the row');
}

async function testCircuitBreaker() {
  console.log('\n# renewal-failure-recovery: circuit breaker');
  // Reset to known clean state
  await resetCircuitBreaker('city_sticker', 'smoke-test');

  const init = await getCircuitBreaker('city_sticker');
  check(init && init.consecutive_failures === 0 && !init.paused_at, 'starts in clean state');

  // Excluded failure does NOT trip
  await recordRenewalFailure('city_sticker', 'missing_credentials test', { excludeFromBreaker: true });
  check(!(await isCircuitTripped('city_sticker')), 'excluded failure does not trip');

  // N consecutive non-excluded failures trip
  for (let i = 0; i < CIRCUIT_BREAKER_THRESHOLD; i++) {
    await recordRenewalFailure('city_sticker', `test failure ${i + 1}`);
  }
  check(await isCircuitTripped('city_sticker'), `${CIRCUIT_BREAKER_THRESHOLD} consecutive failures trip breaker`);

  // Success resets
  await recordRenewalSuccess('city_sticker');
  check(!(await isCircuitTripped('city_sticker')), 'success resets breaker');

  await resetCircuitBreaker('city_sticker', 'smoke-test');
}

async function cleanup() {
  if (createdConsentIds.length === 0) return;
  await supabaseAdmin.from('renewal_purchase_consents').delete().in('id', createdConsentIds);
  console.log(`\nCleaned up ${createdConsentIds.length} test consents.`);
}

async function main() {
  console.log(`Smoke test target user: ${TEST_USER_ID}`);
  try {
    await testVault();
    await testGateGlobal();
    await testGatePerUser();
    await testConsentLifecycle();
    await testCircuitBreaker();
  } finally {
    await cleanup();
  }
  console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} check(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  cleanup().finally(() => process.exit(1));
});
