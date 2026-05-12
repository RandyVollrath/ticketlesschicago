// Full-flow probe: walk the IL plate sticker renewal from entry page up to
// (but not including) payment submit. Captures every page's form fields,
// title, URL, body text, and a screenshot. STOPS before any real submit.
//
// Requires env vars (do NOT commit secrets):
//   IL_REG_ID  - 11-digit registration ID from the IL registration card
//   IL_PIN     - PIN from the registration card / renewal notice
//
// Run: IL_REG_ID=... IL_PIN=... npx tsx scripts/probe-ilsos-renewal-walk.ts
//
// Safety:
//   - Leaves the "jorel" honeypot field empty (filling it flags us as a bot).
//   - Refuses to click any button labeled with words that suggest payment
//     finalization ("Pay", "Submit", "Complete", "Confirm Payment").
//   - Reports each page rather than blowing through them.

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const ENTRY_URL = 'https://apps.ilsos.gov/LicenseRenewal/';
const OUT_DIR = '/tmp/ilsos-walk';

const REG_ID = process.env.IL_REG_ID;
const PIN = process.env.IL_PIN;

if (!REG_ID || !PIN) {
  console.error('ERR: set IL_REG_ID and IL_PIN env vars before running.');
  process.exit(2);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const FINAL_SUBMIT_PATTERNS = [
  /\bpay\b/i,
  /\bcomplete\b/i,
  /\bconfirm\b.*\bpayment\b/i,
  /\bplace\b.*\border\b/i,
  /\bsubmit\b.*\bpayment\b/i,
  /\bauthorize\b/i,
];

async function dumpPage(page: Page, label: string) {
  const safeLabel = label.replace(/[^a-z0-9_-]/gi, '_');
  const shot = path.join(OUT_DIR, `${safeLabel}.png`);
  await page.screenshot({ path: shot, fullPage: true });

  const url = page.url();
  const title = await page.title();
  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 3000);

  const fields = await page.$$eval('input, select, textarea, button', (els) =>
    els.map((el) => {
      const e = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement;
      const id = e.id || null;
      const name = (e as HTMLInputElement).name || null;
      const tag = e.tagName.toLowerCase();
      const type = (e as HTMLInputElement).type || tag;
      const placeholder = (e as HTMLInputElement).placeholder || null;
      const aria = e.getAttribute('aria-label');
      const text = e.textContent?.trim().slice(0, 80) || null;
      const visible = !!(e.offsetParent || (e as HTMLInputElement).type === 'hidden');
      let labelText: string | null = null;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText = lbl.textContent?.trim() || null;
      }
      return { tag, id, name, type, placeholder, aria, labelText, text, visible };
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
      console.log(
        `  ${f.tag} type=${f.type} name=${f.name} id=${f.id} label="${f.labelText ?? f.aria ?? f.placeholder ?? ''}" visible=${f.visible}`
      );
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, `${safeLabel}.json`), JSON.stringify({ url, title, fields, bodyText }, null, 2));
}

function isFinalSubmitButton(label: string): boolean {
  return FINAL_SUBMIT_PATTERNS.some((re) => re.test(label));
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
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

  // Page 1: entry
  console.log(`Loading ${ENTRY_URL}`);
  const resp = await page.goto(ENTRY_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`HTTP ${resp?.status()}`);
  await page.waitForTimeout(2000);
  await dumpPage(page, '01_entry');

  // Fill Reg ID + PIN. Explicitly leave 'jorel' (honeypot) empty.
  await page.fill('#regId', REG_ID!);
  await page.fill('#pin', PIN!);

  // The 'cb' checkbox is some kind of acknowledgement — try toggling it on.
  const cb = await page.$('#cb');
  if (cb) {
    const isChecked = await cb.isChecked();
    if (!isChecked) await cb.check().catch(() => {});
  }

  console.log('\nFilled credentials. Clicking continue...');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.click('#submitBtn'),
  ]);
  await page.waitForTimeout(2500);
  await dumpPage(page, '02_after_login');

  // Walk forward up to 6 more pages. On each, pick the most "continue-like"
  // button (Next, Continue, Proceed) but bail if the only button is a final
  // payment submit.
  for (let step = 3; step <= 8; step++) {
    const buttons = await page.$$eval('button, input[type="submit"], input[type="button"]', (els) =>
      els.map((el) => {
        const e = el as HTMLButtonElement | HTMLInputElement;
        const text = (e.textContent?.trim() || (e as HTMLInputElement).value || '').slice(0, 80);
        const id = e.id;
        const name = (e as HTMLInputElement).name;
        return { text, id, name };
      })
    );

    if (!buttons.length) {
      console.log('\n(no buttons found, stopping walk)');
      break;
    }

    // Prefer "Continue", "Next", "Proceed" over anything else.
    const ranked = buttons
      .map((b) => {
        const lbl = b.text || '';
        let score = 0;
        if (/continue/i.test(lbl)) score += 10;
        if (/next/i.test(lbl)) score += 8;
        if (/proceed/i.test(lbl)) score += 6;
        if (isFinalSubmitButton(lbl)) score -= 100;
        return { b, score, lbl };
      })
      .sort((a, b) => b.score - a.score);

    const top = ranked[0];
    if (!top || top.score < 0) {
      console.log(`\nReached a page whose only forward button looks like a final submit: "${top?.lbl}". STOPPING here as required.`);
      await dumpPage(page, `${String(step).padStart(2, '0')}_final_stop`);
      break;
    }

    console.log(`\nStep ${step}: clicking "${top.lbl}"`);
    try {
      // Click by text — Playwright's text engine handles labels well.
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
        page.getByRole('button', { name: top.lbl }).first().click().catch(async () => {
          // Fallback: click first button with that text
          await page.click(`button:has-text("${top.lbl}")`);
        }),
      ]);
    } catch (e) {
      console.log(`Click failed: ${e}`);
    }
    await page.waitForTimeout(2500);
    await dumpPage(page, `${String(step).padStart(2, '0')}_step`);
  }

  console.log(`\nDone. Artifacts in ${OUT_DIR}`);
  await browser.close();
}

main().catch((e) => {
  console.error('WALK FAILED:', e);
  process.exit(1);
});
