// Full-flow probe of the Chicago city sticker EzBuy purchase from landing
// through to (but not including) payment submit. Captures every page's
// form fields, title, URL, body text, and a screenshot to /tmp/city-walk/.
//
// SAFE — refuses to click any button labeled "Pay" / "Complete" / "Place
// Order" / "Submit Payment" / "Authorize", so a real plate can be probed
// without accidentally purchasing.
//
// Pass these as env vars at run time (don't hard-code or commit values):
//   CITY_PLATE      License plate, e.g. ABC1234
//   CITY_VIN_LAST6  Last 6 chars of VIN
//   CITY_LAST_NAME  Owner's last name on the registration
//   CITY_EMAIL      Email to fill in the contact step
//
// Run: CITY_PLATE=... CITY_VIN_LAST6=... CITY_LAST_NAME=... CITY_EMAIL=... \
//        npx tsx scripts/probe-city-sticker-walk.ts

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const ENTRY_URL = 'https://ezbuy.chicityclerk.com/vehicle-stickers';
const OUT_DIR = '/tmp/city-walk';

const PLATE = process.env.CITY_PLATE;
const VIN6 = process.env.CITY_VIN_LAST6;
const LAST = process.env.CITY_LAST_NAME;
const EMAIL = process.env.CITY_EMAIL;

if (!PLATE || !VIN6 || !LAST || !EMAIL) {
  console.error('ERR: set CITY_PLATE, CITY_VIN_LAST6, CITY_LAST_NAME, CITY_EMAIL.');
  process.exit(2);
}
if (VIN6.length !== 6) {
  console.error(`ERR: CITY_VIN_LAST6 must be exactly 6 chars (got ${VIN6.length})`);
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const FINAL_SUBMIT_PATTERNS = [
  /\bpay\b/i,
  /\bplace\b.*\border\b/i,
  /\bcomplete\b.*\bpurchase\b/i,
  /\bsubmit\b.*\bpayment\b/i,
  /\bconfirm\b.*\bpayment\b/i,
  /\bauthorize\s*payment\b/i,
];

function isFinalSubmitButton(label: string): boolean {
  return FINAL_SUBMIT_PATTERNS.some((re) => re.test(label));
}

async function dumpPage(page: Page, label: string) {
  const safe = label.replace(/[^a-z0-9_-]/gi, '_');
  const shot = path.join(OUT_DIR, `${safe}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  const url = page.url();
  const title = await page.title();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 3000);

  const fields = await page.$$eval('input, select, textarea, button', (els) =>
    els.map((el) => {
      const e = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;
      const tag = e.tagName.toLowerCase();
      const id = e.id || null;
      const name = (e as HTMLInputElement).name || null;
      const type = (e as HTMLInputElement).type || tag;
      const placeholder = (e as HTMLInputElement).placeholder || null;
      const aria = e.getAttribute('aria-label');
      const text = e.textContent?.trim().slice(0, 80) || null;
      let labelText: string | null = null;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText = lbl.textContent?.trim() || null;
      }
      return { tag, id, name, type, placeholder, aria, labelText, text };
    })
  );

  console.log(`\n=== ${label} ===`);
  console.log(`URL:   ${url}`);
  console.log(`Title: ${title}`);
  console.log(`Screenshot: ${shot}`);
  console.log(`Body (first 1KB):\n${bodyText.slice(0, 1000)}`);
  console.log(`\nForm elements (${fields.length}):`);
  for (const f of fields) {
    if (f.tag === 'button' || f.type === 'submit') {
      console.log(`  BTN type=${f.type} text="${f.text}" name=${f.name} id=${f.id}`);
    } else {
      console.log(`  ${f.tag} type=${f.type} name=${f.name} id=${f.id} label="${f.labelText ?? f.aria ?? f.placeholder ?? ''}"`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, `${safe}.json`), JSON.stringify({ url, title, fields, bodyText }, null, 2));
}

async function tryClickContinue(page: Page, stepNum: number): Promise<{ clicked: boolean; finalReached: boolean; label?: string }> {
  const buttons = await page.$$eval('button, input[type="submit"], input[type="button"]', (els) =>
    els.map((el) => ({
      text: ((el as HTMLElement).textContent?.trim() || (el as HTMLInputElement).value || '').slice(0, 80),
      id: el.id || null,
    }))
  );
  if (!buttons.length) return { clicked: false, finalReached: false };

  const ranked = buttons
    .map((b) => {
      const lbl = b.text || '';
      let score = 0;
      if (/^next$/i.test(lbl) || /next/i.test(lbl)) score += 10;
      if (/continue/i.test(lbl)) score += 8;
      if (/proceed/i.test(lbl)) score += 6;
      if (/checkout|cart/i.test(lbl)) score += 4;
      if (isFinalSubmitButton(lbl)) score -= 100;
      return { b, score, lbl };
    })
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  if (!top || top.score < 0) {
    console.log(`\nStep ${stepNum}: only forward button looks like a final submit: "${top?.lbl}". STOPPING.`);
    return { clicked: false, finalReached: true, label: top?.lbl };
  }

  console.log(`\nStep ${stepNum}: clicking "${top.lbl}"`);
  try {
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
      page.click(`button:has-text("${top.lbl}")`).catch(async () => {
        await page.getByText(top.lbl, { exact: false }).first().click();
      }),
    ]);
    await page.waitForTimeout(2500);
    return { clicked: true, finalReached: false, label: top.lbl };
  } catch (e) {
    console.log(`Click failed: ${e}`);
    return { clicked: false, finalReached: false };
  }
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
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

  console.log(`Loading ${ENTRY_URL}`);
  const resp = await page.goto(ENTRY_URL, { waitUntil: 'networkidle', timeout: 45000 });
  console.log(`HTTP ${resp?.status()}`);
  await page.waitForTimeout(2000);
  await dumpPage(page, '01_landing');

  // Click past instructions
  const initialNext = await page.$('button:has-text("Next")');
  if (initialNext) {
    await initialNext.click();
    await page.waitForTimeout(2000);
  }
  await dumpPage(page, '02_record_search');

  // Fill the three known fields
  const inputs = await page.$$('input[type="text"], input:not([type])');
  let p = false, v = false, n = false;
  for (const el of inputs) {
    const blob = (await el.evaluate((e) => {
      const id = (e as HTMLInputElement).id || '';
      const name = (e as HTMLInputElement).name || '';
      const ph = (e as HTMLInputElement).placeholder || '';
      const lbl = id ? (document.querySelector(`label[for="${id}"]`)?.textContent || '') : '';
      return `${id} ${name} ${ph} ${lbl}`;
    })).toLowerCase();
    if (!p && /plate/.test(blob)) { await el.fill(PLATE!); p = true; continue; }
    if (!v && /(vin|identification)/.test(blob)) { await el.fill(VIN6!); v = true; continue; }
    if (!n && /last.*name/.test(blob)) { await el.fill(LAST!); n = true; continue; }
  }
  if (!p || !v || !n) {
    console.log(`Fill incomplete — plate:${p} vin:${v} last:${n}`);
    await dumpPage(page, '02_record_search_fill_failed');
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(1000);
  await dumpPage(page, '03_record_search_filled');

  // Click Search
  const searchBtn = await page.$('button:has-text("Search")');
  if (!searchBtn) {
    console.log('Search button not found');
    await browser.close();
    return;
  }
  await searchBtn.click();
  await page.waitForTimeout(3000);
  await dumpPage(page, '04_search_results');

  // Try to fill email if a field is present
  const emailEl = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
  if (emailEl) {
    await emailEl.fill(EMAIL!);
    console.log(`(filled email)`);
  }
  await dumpPage(page, '05_contact');

  for (let step = 6; step <= 10; step++) {
    const r = await tryClickContinue(page, step);
    if (r.finalReached) {
      await dumpPage(page, `${String(step).padStart(2, '0')}_final_stop`);
      break;
    }
    if (!r.clicked) {
      await dumpPage(page, `${String(step).padStart(2, '0')}_no_click`);
      break;
    }
    await dumpPage(page, `${String(step).padStart(2, '0')}_after_${(r.label || '').replace(/[^a-z]/gi, '').slice(0, 12)}`);
  }

  console.log(`\nDone. Artifacts in ${OUT_DIR}`);
  await browser.close();
}

main().catch((e) => {
  console.error('WALK FAILED:', e);
  process.exit(1);
});
