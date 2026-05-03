/**
 * Headless autonomous probe of the City of Chicago payment portal pay flow.
 *
 * Walks the portal: lookup → results → click "Pay" / "Add to Cart" → continue
 * through any "Continue"/"Next" buttons → STOP at the card-entry form.
 *
 * Does NOT submit any payment. Captures DOM + network at each step so we can
 * design payViaCityPortal() in scripts/run-city-payment-queue.ts.
 *
 * Usage:
 *   npx tsx scripts/probe-city-portal-headless.ts <plate> <state> <lastName>
 *
 * Example:
 *   npx tsx scripts/probe-city-portal-headless.ts EA42467 IL Randall
 *
 * Requires the plate to have at least one unpaid Chicago ticket.
 */

import 'dotenv/config';
import { chromium, type Browser, type Page, type Request, type Response } from 'playwright';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

interface NetworkEvent {
  phase: string;
  ts: string;
  kind: 'request' | 'response';
  method: string;
  url: string;
  status?: number;
  requestBody?: string;
  responseSnippet?: string;
}

interface DomSnapshot {
  phase: string;
  ts: string;
  url: string;
  title: string;
  buttons: Array<{ text: string; id: string | null; cls: string | null; disabled: boolean }>;
  inputs: Array<{
    tag: string;
    type: string | null;
    name: string | null;
    id: string | null;
    placeholder: string | null;
    ariaLabel: string | null;
    formcontrolname: string | null;
  }>;
  iframes: Array<{ src: string | null; name: string | null; id: string | null }>;
  bodyTextSample: string;
}

async function snapshotDom(page: Page, phase: string): Promise<DomSnapshot> {
  const data = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"], input[type="submit"], input[type="button"]'))
      .slice(0, 60)
      .map((el) => ({
        text: (el.textContent || (el as HTMLInputElement).value || '').trim().slice(0, 80),
        id: (el as HTMLElement).id || null,
        cls: (el as HTMLElement).className || null,
        disabled: (el as HTMLButtonElement).disabled === true || el.hasAttribute('disabled'),
      }));
    const inputs = Array.from(document.querySelectorAll('input, select, textarea')).slice(0, 80).map((el) => {
      const e = el as HTMLInputElement;
      return {
        tag: el.tagName,
        type: e.type || null,
        name: e.name || null,
        id: e.id || null,
        placeholder: e.placeholder || null,
        ariaLabel: el.getAttribute('aria-label') || null,
        formcontrolname: el.getAttribute('formcontrolname') || null,
      };
    });
    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => ({
      src: f.getAttribute('src'),
      name: f.getAttribute('name'),
      id: f.id || null,
    }));
    const bodyTextSample = (document.body?.innerText || '').slice(0, 1500);
    return { buttons, inputs, iframes, bodyTextSample };
  });
  return {
    phase,
    ts: new Date().toISOString(),
    url: page.url(),
    title: await page.title().catch(() => ''),
    ...data,
  };
}

// Mirror chicago-portal-scraper.ts exactly — works against this Angular portal
async function fillFormField(page: Page, labelText: string, value: string): Promise<boolean> {
  return page.evaluate(({ labelText, value }) => {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const label = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.includes(labelText) && (input as HTMLElement).offsetParent !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { labelText, value });
}

async function selectDropdownValue(page: Page, labelText: string, value: string): Promise<boolean> {
  return page.evaluate(({ labelText, value }) => {
    const selects = document.querySelectorAll('select');
    for (const select of selects) {
      const label = select.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.includes(labelText) && (select as HTMLElement).offsetParent !== null) {
        for (let i = 0; i < select.options.length; i++) {
          if (select.options[i].value === value ||
              select.options[i].text === value ||
              select.options[i].value.toUpperCase() === value.toUpperCase()) {
            select.selectedIndex = i;
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
            setter.call(select, select.options[i].value);
            select.dispatchEvent(new Event('input', { bubbles: true }));
            select.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      }
    }
    return false;
  }, { labelText, value });
}

async function forceClickSearch(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const btns = document.querySelectorAll('button.btn.btn-primary');
    for (const btn of btns) {
      if ((btn.textContent || '').trim() === 'Search') {
        const h = btn as HTMLButtonElement;
        h.removeAttribute('disabled');
        h.disabled = false;
        h.click();
        return true;
      }
    }
    return false;
  });
}

/**
 * Click the first button matching a text pattern (case-insensitive).
 * Returns the text of the clicked button or null.
 */
async function clickButtonByText(page: Page, patterns: RegExp[]): Promise<string | null> {
  return await page.evaluate((patternStrs) => {
    const regs = patternStrs.map((s) => new RegExp(s, 'i'));
    const els = Array.from(document.querySelectorAll('button, a, input[type="submit"], input[type="button"]')) as HTMLElement[];
    for (const el of els) {
      const txt = ((el.textContent || (el as HTMLInputElement).value || '') + '').trim();
      if (!txt) continue;
      for (const r of regs) {
        if (r.test(txt)) {
          // try removing disabled
          (el as HTMLButtonElement).disabled = false;
          el.removeAttribute('disabled');
          el.click();
          return txt.slice(0, 80);
        }
      }
    }
    return null;
  }, patterns.map((r) => r.source));
}

async function looksLikeCardForm(page: Page): Promise<boolean> {
  return await page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    const cardTextHits = ['card number', 'cardholder', 'cvv', 'cvc', 'expiration', 'expiry', 'credit card', 'billing address'].some((s) => text.includes(s));
    const cardInput = !!document.querySelector('input[autocomplete="cc-number"], input[name*="card" i], input[id*="card" i], input[name*="cc" i], input[placeholder*="card" i]');
    const stripeIframe = !!document.querySelector('iframe[src*="stripe"], iframe[name*="card" i], iframe[name*="stripe" i]');
    return cardTextHits || cardInput || stripeIframe;
  });
}

async function main() {
  const plate = process.argv[2];
  const state = process.argv[3] || 'IL';
  const lastName = process.argv[4];
  if (!plate || !lastName) {
    console.error('Usage: npx tsx scripts/probe-city-portal-headless.ts <plate> <state> <lastName>');
    process.exit(1);
  }

  const outDir = path.resolve('logs');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = Date.now();
  const outFile = path.join(outDir, `city-payment-probe-headless-${stamp}.json`);
  const ssDir = path.join(outDir, `city-payment-probe-headless-${stamp}-screenshots`);
  fs.mkdirSync(ssDir, { recursive: true });

  const network: NetworkEvent[] = [];
  const snapshots: DomSnapshot[] = [];
  let phase = 'init';

  const browser: Browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  // tsx/esbuild injects __name() helper calls into evaluate bodies; shim it in page context
  await context.addInitScript(() => { (globalThis as any).__name = (fn: any) => fn; });
  const page = await context.newPage();

  page.on('request', (req: Request) => {
    const u = req.url();
    if (u.startsWith('data:') || u.includes('analytics') || u.includes('google') || u.includes('hcaptcha')) return;
    network.push({
      phase, ts: new Date().toISOString(), kind: 'request',
      method: req.method(), url: u,
      requestBody: req.postData() || undefined,
    });
  });
  page.on('response', async (resp: Response) => {
    const u = resp.url();
    if (u.startsWith('data:') || u.includes('analytics') || u.includes('google') || u.includes('hcaptcha')) return;
    let snippet: string | undefined;
    try {
      const ct = resp.headers()['content-type'] || '';
      if (ct.includes('json') || ct.includes('text') || ct.includes('html')) {
        const t = await resp.text();
        snippet = t.slice(0, 800);
      }
    } catch { /* */ }
    network.push({
      phase, ts: new Date().toISOString(), kind: 'response',
      method: resp.request().method(), url: u, status: resp.status(),
      responseSnippet: snippet,
    });
  });

  const screenshot = async (name: string) => {
    try { await page.screenshot({ path: path.join(ssDir, `${name}.png`), fullPage: true }); } catch {}
  };

  try {
    phase = 'goto_portal';
    console.log(`[${phase}] ${PORTAL_URL}`);
    await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    await screenshot('01-portal-loaded');
    snapshots.push(await snapshotDom(page, phase));

    phase = 'click_plate_tab';
    console.log(`[${phase}]`);
    try { await page.locator('text=License Plate').first().click({ timeout: 5000 }); } catch (e) { console.log('plate tab click failed:', (e as Error).message); }
    await page.waitForTimeout(2000);
    await screenshot('02-plate-tab');

    phase = 'fill_form';
    console.log(`[${phase}] plate=${plate} state=${state} lastName=${lastName}`);
    const filledPlate = await fillFormField(page, 'License Plate', plate.toUpperCase());
    const filledLast = await fillFormField(page, 'Last Name', lastName);
    const filledState = await selectDropdownValue(page, 'State', state.toUpperCase());
    console.log(`  filled: plate=${filledPlate} last=${filledLast} state=${filledState}`);
    await page.waitForTimeout(2000);
    await screenshot('03-form-filled');

    phase = 'click_search';
    console.log(`[${phase}]`);
    const clicked = await forceClickSearch(page);
    if (!clicked) console.log('  search button not found');
    await page.waitForTimeout(8000);
    await screenshot('04-search-results');
    snapshots.push(await snapshotDom(page, 'search_results'));

    phase = 'select_tickets';
    console.log(`[${phase}]`);
    const checkedCount = await page.evaluate(() => {
      // Check ticket-row checkboxes (id="myCheckbox" — there's one per row)
      const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
      let n = 0;
      for (const cb of cbs) {
        if (cb.id === 'myCheckbox' && (cb as HTMLElement).offsetParent !== null) {
          if (!cb.checked) {
            cb.click();
            cb.dispatchEvent(new Event('change', { bubbles: true }));
            n++;
          }
        }
      }
      return n;
    });
    console.log(`  checked ${checkedCount} ticket checkboxes`);
    await page.waitForTimeout(2000);
    await screenshot('05-tickets-selected');
    snapshots.push(await snapshotDom(page, 'tickets_selected'));

    // Walk forward through any "Continue" / "Next" / "Proceed" buttons
    for (let step = 1; step <= 8; step++) {
      if (await looksLikeCardForm(page)) {
        console.log(`  card form detected at step ${step}, stopping`);
        break;
      }
      phase = `walk_step_${step}`;
      // Once we land on the hostedpayments gateway, click Card payment-type radio first
      const onGateway = page.url().includes('hostedpayments');
      if (onGateway) {
        // The payment-type chooser uses custom clickable components, not radios.
        // Click anywhere in the "Card" row using Playwright's text locator.
        try {
          await page.getByText('Card', { exact: true }).first().click({ timeout: 3000 });
          console.log(`  [gateway] clicked Card option`);
          await page.waitForTimeout(3000);
          await screenshot(`06-walk-step-${step}-card-clicked`);
          snapshots.push(await snapshotDom(page, `gateway_card_clicked_${step}`));
        } catch (e) {
          console.log(`  [gateway] could not click Card: ${(e as Error).message}`);
        }
      }
      const next = await clickButtonByText(page, [/^continue$/i, /^next$/i, /proceed/i, /^checkout$/i, /go\s*to\s*payment/i, /pay\s*now/i, /^submit$/i]);
      console.log(`[${phase}] clicked: ${next || '(no match — stopping walk)'}`);
      if (!next) break;
      await page.waitForTimeout(5000);
      await screenshot(`06-walk-step-${step}`);
      snapshots.push(await snapshotDom(page, phase));
    }

    phase = 'final';
    await screenshot('07-final');
    snapshots.push(await snapshotDom(page, 'final'));

    const cardFormHit = await looksLikeCardForm(page);
    console.log(`\nCard form detected on final page: ${cardFormHit}`);
  } catch (err) {
    console.error('Probe error:', err);
    await screenshot('99-error');
  } finally {
    fs.writeFileSync(outFile, JSON.stringify({
      capturedAt: new Date().toISOString(),
      input: { plate, state, lastName },
      snapshots,
      network,
    }, null, 2));
    console.log(`\nProbe output: ${outFile}`);
    console.log(`Screenshots: ${ssDir}`);
    console.log(`Network events: ${network.length}, DOM snapshots: ${snapshots.length}`);
    await browser.close();
  }
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
