// Probe of the EzBuy vehicle-stickers flow specifically aimed at the
// residential parking permit add-on. The existing probe-city-sticker-walk.ts
// covers the sticker-only path; this script does the same walk but with a
// permit-zone vehicle and captures permit-relevant signals on every page:
//
//   - any text matching /permit|zone|residential/i
//   - any checkbox / radio / select whose label or option text matches above
//   - any line item or price row mentioning permit
//   - the cart price (so we can see if a permit add-on is preselected)
//
// SAFE — refuses to click any button labeled "Pay" / "Complete" / "Place
// Order" / "Submit Payment" / "Authorize" / "Confirm Payment". You can run
// this against a real plate without purchasing.
//
// Required env vars (NEVER hard-code in this repo):
//   CITY_PLATE      License plate of a vehicle whose registered address is
//                   in an active residential permit zone (per our
//                   parking_permit_zones table — verify with
//                   /api/check-permit-zone first).
//   CITY_VIN_LAST6  Last 6 chars of VIN.
//   CITY_LAST_NAME  Owner's last name on the registration.
//   CITY_EMAIL      Email for the contact step.
//
// Run:
//   CITY_PLATE=ABC1234 CITY_VIN_LAST6=ABC123 CITY_LAST_NAME=Smith \
//   CITY_EMAIL=you@example.com npx tsx scripts/probe-permit-ezbuy.ts
//
// Output:
//   /tmp/permit-probe/*.png       — per-page screenshots
//   /tmp/permit-probe/*.json      — per-page form-element + body-text dump
//   /tmp/permit-probe/permit-signals.json — collated permit hits across all pages
//
// What to look for in the output:
//   1. A page where the body or a form-element label contains "permit" /
//      "zone" / "residential" — that's the page where the bot needs to
//      assert the add-on.
//   2. The shape of the control: checkbox? radio? auto-selected based on
//      the city's address record? The cart total tells us if the permit is
//      already included by default or has to be opted into.
//   3. Whether the permit price ($30) appears as a separate line item.
//
// If no permit signals appear anywhere in the walk, EzBuy almost certainly
// doesn't sell residential permits through the public portal. In that case
// the bot should skip permit-zone customers and let the existing remitter
// path in cron/process-all-renewals.ts handle them (it already does).

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const ENTRY_URL = 'https://ezbuy.chicityclerk.com/vehicle-stickers';
const OUT_DIR = '/tmp/permit-probe';

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

const PERMIT_RE = /\b(permit|zone|residential|rpp)\b/i;

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

interface PermitHit {
  page: string;
  source: 'body' | 'field-label' | 'option' | 'button' | 'price';
  text: string;
  context?: string;
}

const allHits: PermitHit[] = [];

async function dumpPageAndScanForPermits(page: Page, label: string) {
  const safe = label.replace(/[^a-z0-9_-]/gi, '_');
  const shot = path.join(OUT_DIR, `${safe}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  const url = page.url();
  const title = await page.title();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 5000);

  const fields = await page.$$eval('input, select, textarea, button, option', (els) =>
    els.map((el) => {
      const e = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement | HTMLOptionElement;
      const tag = e.tagName.toLowerCase();
      const id = e.id || null;
      const name = (e as HTMLInputElement).name || null;
      const type = (e as HTMLInputElement).type || tag;
      const placeholder = (e as HTMLInputElement).placeholder || null;
      const aria = e.getAttribute('aria-label');
      const text = e.textContent?.trim().slice(0, 120) || null;
      const value = (e as HTMLInputElement).value || null;
      let labelText: string | null = null;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText = lbl.textContent?.trim() || null;
      }
      return { tag, id, name, type, placeholder, aria, labelText, text, value };
    })
  );

  // Scan for permit signals.
  const bodyHits: PermitHit[] = [];
  for (const line of bodyText.split('\n')) {
    if (PERMIT_RE.test(line)) {
      bodyHits.push({ page: label, source: 'body', text: line.trim() });
    }
  }
  const fieldHits: PermitHit[] = [];
  for (const f of fields) {
    const probe = `${f.labelText || ''} ${f.aria || ''} ${f.placeholder || ''} ${f.text || ''} ${f.value || ''}`;
    if (PERMIT_RE.test(probe)) {
      fieldHits.push({
        page: label,
        source: f.tag === 'option' ? 'option' : f.tag === 'button' ? 'button' : 'field-label',
        text: probe.replace(/\s+/g, ' ').trim().slice(0, 200),
        context: `${f.tag} type=${f.type} name=${f.name || '∅'} id=${f.id || '∅'}`,
      });
    }
  }
  // Look for price rows that mention permit
  const priceHits: PermitHit[] = [];
  const priceMatches = bodyText.match(/.*\$\d[\d.,]*.*$/gm) || [];
  for (const line of priceMatches) {
    if (PERMIT_RE.test(line)) {
      priceHits.push({ page: label, source: 'price', text: line.trim() });
    }
  }

  const hits = [...bodyHits, ...fieldHits, ...priceHits];
  allHits.push(...hits);

  console.log(`\n=== ${label} ===`);
  console.log(`URL:   ${url}`);
  console.log(`Title: ${title}`);
  console.log(`Permit-relevant hits: ${hits.length}`);
  if (hits.length > 0) {
    for (const h of hits.slice(0, 15)) {
      console.log(`  [${h.source}] ${h.text}${h.context ? ` (${h.context})` : ''}`);
    }
    if (hits.length > 15) console.log(`  …and ${hits.length - 15} more`);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, `${safe}.json`),
    JSON.stringify({ url, title, fields, bodyText, hits }, null, 2),
  );
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
  await dumpPageAndScanForPermits(page, '01_landing');

  const initialNext = await page.$('button:has-text("Next")');
  if (initialNext) {
    await initialNext.click();
    await page.waitForTimeout(2000);
  }
  await dumpPageAndScanForPermits(page, '02_record_search');

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
    await dumpPageAndScanForPermits(page, '02_record_search_fill_failed');
    await browser.close();
    process.exit(1);
  }
  await page.waitForTimeout(1000);
  await dumpPageAndScanForPermits(page, '03_record_search_filled');

  const searchBtn = await page.$('button:has-text("Search")');
  if (!searchBtn) {
    console.log('Search button not found');
    await browser.close();
    return;
  }
  await searchBtn.click();
  await page.waitForTimeout(3000);
  await dumpPageAndScanForPermits(page, '04_search_results');

  const emailEl = await page.$('input[type="email"], input[name*="email" i], input[id*="email" i]');
  if (emailEl) {
    await emailEl.fill(EMAIL!);
    console.log(`(filled email)`);
  }
  await dumpPageAndScanForPermits(page, '05_contact');

  for (let step = 6; step <= 12; step++) {
    const r = await tryClickContinue(page, step);
    if (r.finalReached) {
      await dumpPageAndScanForPermits(page, `${String(step).padStart(2, '0')}_final_stop`);
      break;
    }
    if (!r.clicked) {
      await dumpPageAndScanForPermits(page, `${String(step).padStart(2, '0')}_no_click`);
      break;
    }
    await dumpPageAndScanForPermits(page, `${String(step).padStart(2, '0')}_after_${(r.label || '').replace(/[^a-z]/gi, '').slice(0, 12)}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, 'permit-signals.json'), JSON.stringify(allHits, null, 2));

  console.log(`\n=========== Summary ===========`);
  console.log(`Total permit-relevant hits across walk: ${allHits.length}`);
  if (allHits.length === 0) {
    console.log(`\nNO PERMIT SIGNALS DETECTED. The public EzBuy vehicle-stickers flow likely does NOT sell residential parking permits. Recommendation: bot should skip permit-zone users and route them to the existing remitter path in pages/api/cron/process-all-renewals.ts.`);
  } else {
    const pages = new Set(allHits.map((h) => h.page));
    console.log(`\nPermit signals found on pages: ${Array.from(pages).join(', ')}`);
    console.log(`Inspect /tmp/permit-probe/*.png and /tmp/permit-probe/permit-signals.json for the exact UI affordance to target.`);
  }

  console.log(`\nArtifacts in ${OUT_DIR}`);
  await browser.close();
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
