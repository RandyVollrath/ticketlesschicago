// Production automation for the Illinois Secretary of State plate sticker
// renewal at apps.ilsos.gov/LicenseRenewal/.
//
// Known facts (from scripts/probe-ilsos-renewal.ts):
//   - Entry form has TWO visible inputs: #regId (Registration ID) and #pin.
//   - There is NO CAPTCHA. Akamai bot detection is the gate; stealth
//     Playwright (webdriver unset, realistic UA, Chicago tz, real Accept-*
//     headers) gets through cleanly.
//   - A hidden #jorel field is a honeypot — never fill it.
//   - The pages AFTER login are not yet probed. This module stops after
//     the login submit and surfaces a TODO until the credentialed probe
//     (scripts/probe-ilsos-renewal-walk.ts) is run.
//
// Gated by:
//   - assertAutoRenewalAllowed(userId)
//   - granted ConsentRecord (renewal_type='license_plate')
//   - il_registration_id_encrypted + il_pin_encrypted populated for the user

import { chromium, Browser, Page } from 'playwright';
import { assertAutoRenewalAllowed } from './auto-renewal-gate';
import type { ConsentRecord } from './renewal-consent';
import { consumeConsent } from './renewal-consent';
import { decryptCredential } from './credentials-vault';
import { supabaseAdmin } from './supabase';
import { assertCircuitClosed, reportRenewalResult } from './renewal-failure-recovery';

const ENTRY_URL = 'https://apps.ilsos.gov/LicenseRenewal/';

export interface PlateStickerPurchaseInput {
  consent: ConsentRecord;
  userEmail: string;
  dryRun: boolean;
  headed?: boolean;
}

export interface PlateStickerPurchaseResult {
  success: boolean;
  confirmationNumber?: string;
  totalChargedCents?: number;
  screenshotPaths: string[];
  error?: string;
  stoppedAt?:
    | 'gate'
    | 'consent'
    | 'missing_credentials'
    | 'akamai_block'
    | 'login_form_changed'
    | 'invalid_credentials'
    | 'login_success'
    | 'payment_not_configured'
    | 'payment_form'
    | 'submit'
    | 'confirmation';
  invalidCredentialsDetected?: boolean;
}

// Reuses the same CITY_PAYMENT_CARD_* env-var set as ticket autopay so one
// operations card pays both renewals AND tickets. See the comment in
// lib/city-sticker-purchase.ts on the Vercel-vs-worker-machine security
// stance.
function readGovCardConfig() {
  const number = (process.env.CITY_PAYMENT_CARD_NUMBER || '').replace(/\s+/g, '');
  const expRaw = (process.env.CITY_PAYMENT_CARD_EXP || '').trim();
  const cvv = (process.env.CITY_PAYMENT_CARD_CVV || '').trim();
  const billFirst = process.env.CITY_PAYMENT_BILLING_FIRST_NAME?.trim();
  const billLast = process.env.CITY_PAYMENT_BILLING_LAST_NAME?.trim();
  const addr1 = process.env.CITY_PAYMENT_BILLING_ADDRESS1?.trim();
  const billCity = process.env.CITY_PAYMENT_BILLING_CITY?.trim();
  const billState = process.env.CITY_PAYMENT_BILLING_STATE?.trim();
  const zip = process.env.CITY_PAYMENT_BILLING_ZIP?.trim();
  const billEmail = process.env.CITY_PAYMENT_BILLING_EMAIL?.trim();
  if (!number || !expRaw || !cvv || !billFirst || !billLast || !addr1 || !billCity || !billState || !zip || !billEmail) return null;
  const match = expRaw.match(/^(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, expMonth, expYear] = match;
  return { number, expMonth, expYear, cvv, zip, billFirst, billLast, addr1, billCity, billState, billEmail };
}

async function newStealthBrowser(headed: boolean): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({
    headless: !headed,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua': '"Chromium";v="126", "Not-A.Brand";v="8"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
    },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  return { browser, page };
}

async function loadDecryptedCredentials(userId: string): Promise<{ regId: string; pin: string } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('il_registration_id_encrypted, il_pin_encrypted' as any)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return { error: `user_profiles read failed: ${error.message}` };
  const row = data as unknown as { il_registration_id_encrypted: string | null; il_pin_encrypted: string | null } | null;
  if (!row?.il_pin_encrypted || !row.il_registration_id_encrypted) {
    return { error: 'IL credentials not on file' };
  }
  try {
    const regId = decryptCredential(row.il_registration_id_encrypted);
    const pin = decryptCredential(row.il_pin_encrypted);
    return { regId, pin };
  } catch (e: any) {
    return { error: `credential decrypt failed: ${e?.message || String(e)}` };
  }
}

async function markCredentialsInvalid(userId: string) {
  try {
    await supabaseAdmin
      .from('user_profiles')
      .update({ il_credentials_invalid_at: new Date().toISOString() } as any)
      .eq('user_id', userId);
  } catch (e) {
    console.error('[plate-sticker] failed to mark credentials invalid', e);
  }
}

export async function purchasePlateSticker(input: PlateStickerPurchaseInput): Promise<PlateStickerPurchaseResult> {
  const screenshots: string[] = [];
  const { consent, dryRun } = input;

  try {
    await assertAutoRenewalAllowed(consent.user_id);
  } catch (e: any) {
    return { success: false, screenshotPaths: [], error: e?.message || 'gate failed', stoppedAt: 'gate' };
  }

  try {
    await assertCircuitClosed('license_plate');
  } catch (e: any) {
    return { success: false, screenshotPaths: [], error: e?.message || 'circuit tripped', stoppedAt: 'gate' };
  }

  if (consent.status !== 'granted') {
    return { success: false, screenshotPaths: [], error: `Consent not granted (status=${consent.status})`, stoppedAt: 'consent' };
  }

  const creds = await loadDecryptedCredentials(consent.user_id);
  if ('error' in creds) {
    return { success: false, screenshotPaths: [], error: creds.error, stoppedAt: 'missing_credentials' };
  }

  let browser: Browser | null = null;
  try {
    const stealth = await newStealthBrowser(Boolean(input.headed));
    browser = stealth.browser;
    const page = stealth.page;

    const resp = await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = resp?.status() ?? 0;
    if (status >= 400) {
      const shot = `/tmp/plate-akamai-block-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return { success: false, screenshotPaths: screenshots, error: `Akamai blocked entry (HTTP ${status})`, stoppedAt: 'akamai_block' };
    }
    await page.waitForTimeout(2000);

    // Confirm the form shape we already probed. If selectors have moved,
    // bail loudly instead of typing the PIN into random fields.
    const regIdEl = await page.$('#regId');
    const pinEl = await page.$('#pin');
    const jorelEl = await page.$('#jorel'); // honeypot
    if (!regIdEl || !pinEl) {
      const shot = `/tmp/plate-login-form-changed-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return { success: false, screenshotPaths: screenshots, error: 'Login form selectors not found (#regId/#pin)', stoppedAt: 'login_form_changed' };
    }
    // Sanity: if we ever start filling jorel we want to know immediately.
    if (jorelEl) {
      const honeyValue = await jorelEl.evaluate((e) => (e as HTMLInputElement).value);
      if (honeyValue) {
        return { success: false, screenshotPaths: screenshots, error: 'Honeypot #jorel has a value (would be flagged as bot)', stoppedAt: 'login_form_changed' };
      }
    }

    await regIdEl.fill(creds.regId);
    await pinEl.fill(creds.pin);

    // Acknowledgement checkbox (#cb) — present on entry per the probe.
    const cb = await page.$('#cb');
    if (cb && !(await cb.isChecked())) {
      await cb.check().catch(() => {});
    }

    await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {}), page.click('#submitBtn').catch(() => {})]);
    await page.waitForTimeout(2500);

    const postLoginText = await page.evaluate(() => document.body?.innerText || '');
    // IL SOS error copy varies: "Invalid", "does not match", "could not be found"...
    if (/invalid|does not match|could not be found|not match our records/i.test(postLoginText)) {
      const shot = `/tmp/plate-invalid-creds-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      await markCredentialsInvalid(consent.user_id);
      return {
        success: false,
        screenshotPaths: screenshots,
        error: 'IL SOS rejected the saved Registration ID + PIN. User likely got new plates (state 10-year program or replace). Marked credentials invalid; user must re-enter via Settings.',
        stoppedAt: 'invalid_credentials',
        invalidCredentialsDetected: true,
      };
    }

    const loginShot = `/tmp/plate-login-success-${consent.id}.png`;
    await page.screenshot({ path: loginShot, fullPage: true });
    screenshots.push(loginShot);

    if (dryRun) {
      return { success: true, screenshotPaths: screenshots, stoppedAt: 'login_success' };
    }

    const cardConfig = readGovCardConfig();
    if (!cardConfig) {
      return {
        success: false,
        screenshotPaths: screenshots,
        error: 'Outbound gov card not configured (PLATE_GOV_CARD_* env vars missing). Run flow halted at login_success.',
        stoppedAt: 'payment_not_configured',
      };
    }

    // TODO: post-login flow is not yet probed. scripts/probe-ilsos-renewal-walk.ts
    // captures every subsequent screen once a real Reg ID + PIN is supplied;
    // that output will define the selectors for vehicle confirmation,
    // address review, fee summary, and payment fields. Until that probe
    // runs, the production flow halts here.
    return {
      success: false,
      screenshotPaths: screenshots,
      error: 'Post-login flow not yet probed. Run scripts/probe-ilsos-renewal-walk.ts with valid creds to capture the remaining screens before wiring payment.',
      stoppedAt: 'login_success',
    };
  } catch (e: any) {
    return { success: false, screenshotPaths: screenshots, error: e?.message || String(e), stoppedAt: 'login_form_changed' };
  } finally {
    if (browser) await browser.close();
  }
}

export async function runPlateStickerRenewal(input: PlateStickerPurchaseInput): Promise<PlateStickerPurchaseResult> {
  const result = await purchasePlateSticker(input);
  try {
    await consumeConsent(input.consent.id, {
      success: result.success,
      data: result.success
        ? { confirmation_number: result.confirmationNumber, total_charged_cents: result.totalChargedCents, stopped_at: result.stoppedAt }
        : null,
      failureReason: result.success ? undefined : `${result.stoppedAt || 'unknown'}: ${result.error || 'failed'}`,
    });
  } catch (e) {
    console.error('[plate-sticker] consumeConsent failed', e);
  }
  try {
    await reportRenewalResult('license_plate', result);
  } catch (e) {
    console.error('[plate-sticker] reportRenewalResult failed', e);
  }
  return result;
}
