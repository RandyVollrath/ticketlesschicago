/**
 * Probe the City of Chicago payment portal payment flow.
 *
 * Goal: figure out what selectors / network calls the "Pay this ticket"
 * flow uses, WITHOUT actually submitting any payment. Output is captured
 * to a JSON file for the operator to inspect.
 *
 * Usage:
 *   npx tsx scripts/probe-city-portal-payment.ts <plate> <state>
 *
 * Example:
 *   npx tsx scripts/probe-city-portal-payment.ts CW22016T IL
 *
 * What it does:
 *   1. Opens the portal in a non-headless browser (you can see what's happening)
 *   2. Looks up the plate
 *   3. Pauses BEFORE clicking any "Pay" button — you click it manually
 *   4. Records every network request from the moment you click
 *   5. Captures the payment form HTML (selectors, field names)
 *   6. Saves everything to logs/city-payment-probe-<timestamp>.json
 *   7. Exits — does NOT submit any payment
 *
 * After running, share the output JSON. The selectors + endpoints will
 * tell us how to implement payViaCityPortal() in run-city-payment-queue.ts.
 */

import 'dotenv/config';
import { chromium, type Request, type Response } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

async function main() {
  const plate = process.argv[2];
  const state = process.argv[3] || 'IL';
  if (!plate) {
    console.error('Usage: npx tsx scripts/probe-city-portal-payment.ts <plate> <state>');
    process.exit(1);
  }

  const outDir = path.resolve('logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `city-payment-probe-${Date.now()}.json`);

  const networkLog: Array<{
    phase: string;
    timestamp: string;
    method: string;
    url: string;
    status?: number;
    requestBody?: string;
    responseSnippet?: string;
  }> = [];
  let phase = 'lookup';

  const browser = await chromium.launch({
    headless: false, // visible so the operator can see/interact
    slowMo: 250,
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('request', (req: Request) => {
    if (req.url().includes('/payments-web/api') || req.url().includes('checkout') || req.url().includes('pay')) {
      networkLog.push({
        phase,
        timestamp: new Date().toISOString(),
        method: req.method(),
        url: req.url(),
        requestBody: req.postData() || undefined,
      });
    }
  });
  page.on('response', async (resp: Response) => {
    if (resp.url().includes('/payments-web/api') || resp.url().includes('checkout') || resp.url().includes('pay')) {
      let snippet: string | undefined;
      try {
        const text = await resp.text();
        snippet = text.slice(0, 500);
      } catch { /* binary or already-consumed body */ }
      networkLog.push({
        phase,
        timestamp: new Date().toISOString(),
        method: resp.request().method(),
        url: resp.url(),
        status: resp.status(),
        responseSnippet: snippet,
      });
    }
  });

  console.log(`Opening ${PORTAL_URL}`);
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  console.log('Waiting 8s for Angular to bootstrap...');
  await page.waitForTimeout(8000);

  console.log(`Looking up ${plate}/${state}...`);
  // Use the same field-fill pattern as the existing scraper. If that doesn't
  // work in non-headless mode, the operator can complete the lookup manually.
  try {
    await page.evaluate(({ plate, state }) => {
      const setNative = (el: HTMLInputElement | HTMLSelectElement, v: string) => {
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        setter?.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const plateInput = document.querySelector<HTMLInputElement>('input[formcontrolname="licensePlateNumber"], input[name*="plate"]');
      const stateSelect = document.querySelector<HTMLSelectElement>('select[formcontrolname="licensePlateState"], select[name*="state"]');
      if (plateInput) setNative(plateInput, plate);
      if (stateSelect) setNative(stateSelect, state);
    }, { plate, state });
  } catch (e) {
    console.log('Auto-fill failed (likely portal layout changed). Please fill the form manually in the browser window.');
  }

  console.log('');
  console.log('================================================================');
  console.log('  MANUAL STEPS — please do these in the browser window:');
  console.log('  1. Complete the lookup if it did not auto-fill');
  console.log('  2. Click Search');
  console.log('  3. Wait for tickets to appear');
  console.log('  4. Click the "Pay" button on the first ticket (or "Add to Cart")');
  console.log('  5. Walk to the payment-form page (whatever the portal calls it)');
  console.log('  6. STOP RIGHT BEFORE entering card details — do NOT submit payment');
  console.log('  7. Press Enter in this terminal to capture and exit');
  console.log('================================================================');
  console.log('');

  phase = 'click_pay';

  await new Promise<void>((resolve) => {
    process.stdin.once('data', () => resolve());
  });

  phase = 'capture';

  // Snapshot the current URL + DOM so we know where the form lives + its selectors
  const snapshot = {
    finalUrl: page.url(),
    title: await page.title(),
    paymentFormHtml: await page.evaluate(() => {
      // Look for likely card-form containers
      const candidates = Array.from(document.querySelectorAll(
        'form, [class*="payment"], [class*="checkout"], [class*="card"], [id*="payment"], [id*="checkout"]'
      ));
      return candidates.slice(0, 5).map((el) => ({
        tag: el.tagName,
        id: (el as HTMLElement).id || null,
        className: (el as HTMLElement).className || null,
        outerHtmlSnippet: el.outerHTML.slice(0, 2000),
      }));
    }),
    inputsOnPage: await page.evaluate(() => {
      return Array.from(document.querySelectorAll('input, select, button')).slice(0, 50).map((el) => {
        const e = el as HTMLInputElement;
        return {
          tag: el.tagName,
          type: e.type || null,
          name: e.name || null,
          id: e.id || null,
          placeholder: e.placeholder || null,
          ariaLabel: e.getAttribute('aria-label') || null,
          formcontrolname: el.getAttribute('formcontrolname') || null,
          textContent: el.tagName === 'BUTTON' ? (el.textContent || '').trim().slice(0, 60) : null,
        };
      });
    }),
  };

  fs.writeFileSync(
    outFile,
    JSON.stringify({
      capturedAt: new Date().toISOString(),
      input: { plate, state },
      networkLog,
      snapshot,
    }, null, 2),
  );

  console.log('');
  console.log(`Probe output written to: ${outFile}`);
  console.log(`Network requests captured: ${networkLog.length}`);
  console.log('');
  console.log('Closing browser. Review the output JSON to design payViaCityPortal().');

  await browser.close();
}

main().catch((err) => {
  console.error('Probe failed:', err);
  process.exit(1);
});
