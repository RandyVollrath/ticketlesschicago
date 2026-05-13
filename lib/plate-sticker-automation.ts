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
import {
  fillGovPaymentForm,
  clickPaymentSubmit,
  clickContinue,
  looksLikePaymentForm,
  scrapeConfirmationReference,
} from './gov-payment-form';

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

async function loadDecryptedCredentials(
  userId: string,
  plateId?: string | null,
): Promise<{ regId: string; pin: string } | { error: string }> {
  // Per-plate credentials live on monitored_plates when plate_id is set; the
  // legacy single-plate path reads user_profiles.
  if (plateId) {
    const { data, error } = await (supabaseAdmin as any)
      .from('monitored_plates')
      .select('il_registration_id_encrypted, il_pin_encrypted')
      .eq('id', plateId)
      .maybeSingle();
    if (error) return { error: `monitored_plates read failed: ${error.message}` };
    const row = data as unknown as { il_registration_id_encrypted: string | null; il_pin_encrypted: string | null } | null;
    if (!row?.il_pin_encrypted || !row.il_registration_id_encrypted) {
      return { error: 'IL credentials not on file for this plate' };
    }
    try {
      return { regId: decryptCredential(row.il_registration_id_encrypted), pin: decryptCredential(row.il_pin_encrypted) };
    } catch (e: any) {
      return { error: `credential decrypt failed: ${e?.message || String(e)}` };
    }
  }

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
    return { regId: decryptCredential(row.il_registration_id_encrypted), pin: decryptCredential(row.il_pin_encrypted) };
  } catch (e: any) {
    return { error: `credential decrypt failed: ${e?.message || String(e)}` };
  }
}

async function markCredentialsInvalid(userId: string, plateId?: string | null) {
  try {
    if (plateId) {
      await (supabaseAdmin as any)
        .from('monitored_plates')
        .update({ il_credentials_invalid_at: new Date().toISOString() })
        .eq('id', plateId);
    } else {
      await supabaseAdmin
        .from('user_profiles')
        .update({ il_credentials_invalid_at: new Date().toISOString() } as any)
        .eq('user_id', userId);
    }
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

  const creds = await loadDecryptedCredentials(consent.user_id, (consent as any).plate_id || null);
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
    await page.waitForTimeout(3500);

    // IL SOS rejects in TWO ways and we need to catch both:
    //   1. Some pages show an error string we can regex on
    //   2. Many rejections silently re-render the entry page with no error
    //      copy (verified by e2e dry-run 2026-05-12 — fake creds came back
    //      to the entry form with no "invalid" anywhere on the page).
    //      We detect that case by checking: are we still on /LicenseRenewal/
    //      with the #regId and #pin fields still visible after submission?
    //      That's a strong-enough signal to mark credentials invalid.
    const postLoginText = await page.evaluate(() => document.body?.innerText || '');
    const regIdStillPresent = (await page.$('#regId')) !== null;
    const pinStillPresent = (await page.$('#pin')) !== null;
    const stillOnEntry = regIdStillPresent && pinStillPresent;

    const errorWords =
      /invalid|does not match|could not be found|not match our records|unable to (locate|find)|no record|please verify/i;

    if (errorWords.test(postLoginText) || stillOnEntry) {
      const shot = `/tmp/plate-invalid-creds-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      await markCredentialsInvalid(consent.user_id, (consent as any).plate_id || null);
      const detectMethod = errorWords.test(postLoginText) ? 'error-text' : 'still-on-entry-form';
      return {
        success: false,
        screenshotPaths: screenshots,
        error: `IL SOS rejected the saved Registration ID + PIN (detected via ${detectMethod}). User likely got new plates (state 10-year program or replate). Marked credentials invalid; user must re-enter via Settings.`,
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

    // Speculative post-login walk: click forward through vehicle/address
    // confirmation screens until we reach a payment form, then fuzzy-fill
    // and submit. Screenshots every step so a failed first run tells us
    // exactly where to harden.
    let onPaymentForm = await looksLikePaymentForm(page);
    let walkSteps = 0;
    while (!onPaymentForm && walkSteps < 10) {
      const clicked = await clickContinue(page);
      if (!clicked) break;
      await page.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(2500);
      const shot = `/tmp/plate-walk-${consent.id}-${walkSteps}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      onPaymentForm = await looksLikePaymentForm(page);
      walkSteps++;
    }
    if (!onPaymentForm) {
      const shot = `/tmp/plate-no-payment-form-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return {
        success: false,
        screenshotPaths: screenshots,
        error: `Walked ${walkSteps} step(s) past login but never landed on a card-number form. IL SOS layout has changed or our continue-button heuristic missed.`,
        stoppedAt: 'payment_form',
      };
    }

    const fillResult = await fillGovPaymentForm(page, cardConfig);
    const filledShot = `/tmp/plate-payment-filled-${consent.id}.png`;
    await page.screenshot({ path: filledShot, fullPage: true });
    screenshots.push(filledShot);

    if (!fillResult.paymentMinimumMet) {
      return {
        success: false,
        screenshotPaths: screenshots,
        error: `IL SOS payment form fill incomplete. Filled: ${fillResult.filled.join(', ')}. Missing: ${fillResult.missing.join(', ')}.`,
        stoppedAt: 'payment_form',
      };
    }

    const submitLabel = await clickPaymentSubmit(page);
    if (!submitLabel) {
      const cont = await clickContinue(page);
      if (cont) {
        await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(3000);
        const reviewShot = `/tmp/plate-review-${consent.id}.png`;
        await page.screenshot({ path: reviewShot, fullPage: true });
        screenshots.push(reviewShot);
        const finalSubmit = await clickPaymentSubmit(page);
        if (!finalSubmit) {
          return {
            success: false,
            screenshotPaths: screenshots,
            error: 'Filled IL SOS payment form but could not locate a final Submit button.',
            stoppedAt: 'submit',
          };
        }
      } else {
        return {
          success: false,
          screenshotPaths: screenshots,
          error: 'Filled IL SOS payment form but could not locate a Submit or Continue button.',
          stoppedAt: 'submit',
        };
      }
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(6000);
    const confirmationShot = `/tmp/plate-confirmation-${consent.id}.png`;
    await page.screenshot({ path: confirmationShot, fullPage: true });
    screenshots.push(confirmationShot);

    const confirmationNumber = (await scrapeConfirmationReference(page)) || undefined;
    return {
      success: true,
      confirmationNumber,
      screenshotPaths: screenshots,
      stoppedAt: 'confirmation',
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
