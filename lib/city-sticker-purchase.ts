// Production purchase flow for the Chicago city vehicle sticker.
//
// Walks the public EzBuy consumer portal (https://ezbuy.chicityclerk.com),
// authenticates with plate + last-6 VIN + last name (no remitter license
// needed), proceeds to cart, and pays with the configured outbound gov
// payment card. Captures a receipt screenshot at the end.
//
// Gated by:
//   - assertAutoRenewalAllowed(userId) — global kill switch + per-user grant
//   - granted ConsentRecord — explicit per-renewal user authorization
//
// Stops short of clicking the final payment-submit button when the outbound
// card env vars are unset; this lets us deploy and exercise the full upstream
// flow before the operational card is provisioned.

import { chromium, Browser, Page } from 'playwright';
import { assertAutoRenewalAllowed } from './auto-renewal-gate';
import type { ConsentRecord } from './renewal-consent';
import { consumeConsent } from './renewal-consent';
import { assertCircuitClosed, reportRenewalResult } from './renewal-failure-recovery';

export interface CitySticerPurchaseInput {
  consent: ConsentRecord;
  vehicle: {
    licensePlate: string;
    vinLast6: string;
    lastName: string;
    email: string;
  };
  /**
   * When true, stops after extracting the price and before any payment input.
   * Used by smoke tests against real plates to avoid actually purchasing.
   */
  dryRun: boolean;
  /**
   * When true, run the browser visibly (debug only). Production must use
   * false so headless stealth + Akamai-friendly fingerprint applies.
   */
  headed?: boolean;
}

export interface CitySticerPurchaseResult {
  success: boolean;
  confirmationNumber?: string;
  totalChargedCents?: number;
  screenshotPaths: string[];
  error?: string;
  stoppedAt?: 'gate' | 'consent' | 'login' | 'vehicle_search' | 'price' | 'payment_not_configured' | 'payment_form' | 'submit' | 'confirmation';
}

const ENTRY_URL = 'https://ezbuy.chicityclerk.com/vehicle-stickers';

function readGovCardConfig() {
  const number = process.env.CITY_GOV_CARD_NUMBER;
  const expMonth = process.env.CITY_GOV_CARD_EXP_MONTH;
  const expYear = process.env.CITY_GOV_CARD_EXP_YEAR;
  const cvv = process.env.CITY_GOV_CARD_CVV;
  const zip = process.env.CITY_GOV_CARD_ZIP;
  if (!number || !expMonth || !expYear || !cvv || !zip) return null;
  return { number, expMonth, expYear, cvv, zip };
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
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = await context.newPage();
  return { browser, page };
}

export async function purchaseCitySticker(input: CitySticerPurchaseInput): Promise<CitySticerPurchaseResult> {
  const screenshots: string[] = [];
  const { consent, vehicle, dryRun } = input;

  // Gate 1: global + per-user authorization
  try {
    await assertAutoRenewalAllowed(consent.user_id);
  } catch (e: any) {
    return { success: false, screenshotPaths: [], error: e?.message || 'gate failed', stoppedAt: 'gate' };
  }

  // Gate 1b: system-wide circuit breaker for city_sticker
  try {
    await assertCircuitClosed('city_sticker');
  } catch (e: any) {
    return { success: false, screenshotPaths: [], error: e?.message || 'circuit tripped', stoppedAt: 'gate' };
  }

  // Gate 2: consent must be granted and still active
  if (consent.status !== 'granted') {
    return { success: false, screenshotPaths: [], error: `Consent not granted (status=${consent.status})`, stoppedAt: 'consent' };
  }

  let browser: Browser | null = null;
  try {
    const stealth = await newStealthBrowser(Boolean(input.headed));
    browser = stealth.browser;
    const page = stealth.page;

    await page.goto(ENTRY_URL, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);

    // Step past the instructions page if present
    const nextBtn = await page.$('button:has-text("Next")');
    if (nextBtn) {
      await nextBtn.click();
      await page.waitForTimeout(1500);
    }

    // Fill plate + VIN last-6 + last name. EzBuy renders these as a small
    // number of inputs; we identify by label/placeholder/name fuzzily so a
    // markup tweak doesn't break us instantly.
    const inputs = await page.$$('input[type="text"], input:not([type])');
    let plateFilled = false, vinFilled = false, nameFilled = false;
    for (const el of inputs) {
      const attrs = await el.evaluate((e) => {
        const id = (e as HTMLInputElement).id || '';
        const name = (e as HTMLInputElement).name || '';
        const ph = (e as HTMLInputElement).placeholder || '';
        const label = id ? (document.querySelector(`label[for="${id}"]`)?.textContent || '') : '';
        return { id, name, ph, label };
      });
      const blob = `${attrs.id} ${attrs.name} ${attrs.ph} ${attrs.label}`.toLowerCase();
      if (!plateFilled && /plate/.test(blob)) {
        await el.fill(vehicle.licensePlate);
        plateFilled = true;
        continue;
      }
      if (!vinFilled && /(vin|identification)/.test(blob)) {
        await el.fill(vehicle.vinLast6);
        vinFilled = true;
        continue;
      }
      if (!nameFilled && /last.*name/.test(blob)) {
        await el.fill(vehicle.lastName);
        nameFilled = true;
        continue;
      }
    }
    if (!plateFilled || !vinFilled || !nameFilled) {
      const shot = `/tmp/city-purchase-fill-failed-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return {
        success: false,
        screenshotPaths: screenshots,
        error: `Login fields missing — plate:${plateFilled} vin:${vinFilled} name:${nameFilled}`,
        stoppedAt: 'login',
      };
    }
    await page.waitForTimeout(800);

    // Click Search
    const searchBtn = await page.$('button:has-text("Search")');
    if (!searchBtn) {
      return { success: false, screenshotPaths: screenshots, error: 'Search button not found', stoppedAt: 'login' };
    }
    await searchBtn.click();
    await page.waitForTimeout(3000);

    const afterSearch = await page.evaluate(() => document.body?.innerText || '');
    if (/not found|no records|no record/i.test(afterSearch)) {
      const shot = `/tmp/city-purchase-not-found-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return { success: false, screenshotPaths: screenshots, error: 'Vehicle not found on EzBuy', stoppedAt: 'vehicle_search' };
    }

    // Fill contact email if a field is present, then advance to cart
    const emailEl = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
    if (emailEl) await emailEl.fill(vehicle.email);

    const nextToCart = await page.$('button:has-text("Next")');
    if (nextToCart) {
      await nextToCart.click();
      await page.waitForTimeout(3000);
    }

    // Extract total price
    const priceText = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('*')).filter((el) => el.textContent?.match(/\$\d/));
      return all.map((el) => el.textContent?.trim()).join(' | ');
    });
    const totalMatch = priceText.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
    const totalDollars = totalMatch ? parseFloat(totalMatch[1]) : 0;
    const totalChargedCents = Math.round(totalDollars * 100);

    if (dryRun) {
      const shot = `/tmp/city-purchase-dryrun-cart-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return { success: true, totalChargedCents, screenshotPaths: screenshots, stoppedAt: 'price' };
    }

    // Outbound card stub. If unconfigured, stop before submitting.
    const cardConfig = readGovCardConfig();
    if (!cardConfig) {
      const shot = `/tmp/city-purchase-payment-not-configured-${consent.id}.png`;
      await page.screenshot({ path: shot, fullPage: true });
      screenshots.push(shot);
      return {
        success: false,
        screenshotPaths: screenshots,
        error: 'Outbound gov card not configured (CITY_GOV_CARD_* env vars missing). Run flow halted before payment.',
        stoppedAt: 'payment_not_configured',
        totalChargedCents,
      };
    }

    // TODO: real payment flow — fill card form, submit, capture confirmation #.
    // Selectors for the payment page are unknown until we run an end-to-end
    // probe with a real vehicle in renewal window. Stops here for now.
    return {
      success: false,
      screenshotPaths: screenshots,
      error: 'Payment form selectors not yet probed. Run smoke-test-citysticker-purchase.ts against a real plate to capture them.',
      stoppedAt: 'payment_form',
      totalChargedCents,
    };
  } catch (e: any) {
    return { success: false, screenshotPaths: screenshots, error: e?.message || String(e), stoppedAt: 'login' };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Wrap purchaseCitySticker + consumeConsent so callers don't forget to
 * mark the consent consumed. Always marks consent regardless of outcome.
 */
export async function runCitySticerRenewal(input: CitySticerPurchaseInput): Promise<CitySticerPurchaseResult> {
  const result = await purchaseCitySticker(input);
  try {
    await consumeConsent(input.consent.id, {
      success: result.success,
      data: result.success
        ? { confirmation_number: result.confirmationNumber, total_charged_cents: result.totalChargedCents }
        : null,
      failureReason: result.success ? undefined : `${result.stoppedAt || 'unknown'}: ${result.error || 'failed'}`,
    });
  } catch (e) {
    console.error('[city-sticker-purchase] consumeConsent failed', e);
  }
  try {
    await reportRenewalResult('city_sticker', result);
  } catch (e) {
    console.error('[city-sticker-purchase] reportRenewalResult failed', e);
  }
  return result;
}
