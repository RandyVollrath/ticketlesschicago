#!/usr/bin/env npx tsx
/**
 * Reconnaissance #3: compare what the CHI PAY parking-service returns
 * across its three search categories:
 *   - License Plate (searchCategoryId=3, what we use today)
 *   - Ticket Number (searchCategoryId=5)
 *   - Notice Number (searchCategoryId=4)
 *
 * If any of Ticket-Number or Notice-Number search returns additional field
 * keys that License-Plate doesn't — particularly an address or officer or
 * photo URL — we'd switch to that search type and get address automatically.
 *
 * Uses Travis Bee's known ticket #9306367440 (Notice Number unknown so that
 * search is done by Ticket Number which is 10 digits, same format).
 *
 * Output: /tmp/portal-alt-search/{timestamp}/
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

// Known Travis tickets (2026-02)
const TICKET_NUMBER = '9306367440';

async function setInputByLabel(page: Page, labelContains: string, value: string): Promise<boolean> {
  return page.evaluate(({ labelContains, value }) => {
    const inputs = document.querySelectorAll('input');
    for (const input of inputs) {
      const label = input.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
      if (label.toLowerCase().includes(labelContains.toLowerCase()) && (input as HTMLElement).offsetParent !== null) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { labelContains, value });
}

async function forceClickSearch(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button.btn.btn-primary');
    for (const btn of btns) {
      if (btn.textContent?.trim() === 'Search') {
        (btn as HTMLButtonElement).removeAttribute('disabled');
        (btn as HTMLButtonElement).disabled = false;
        (btn as HTMLButtonElement).click();
        return true;
      }
    }
    return false;
  });
}

async function runSearch(page: Page, tabLabel: string, fillFn: () => Promise<void>, outDir: string, label: string) {
  console.log(`\n━━━ ${label} ━━━`);

  // Capture search API response
  let body: any = null;
  const handler = async (resp: any) => {
    if (resp.url().includes('/payments-web/api/searches') && resp.request().method() === 'POST') {
      try { body = JSON.parse(await resp.text()); } catch {}
    }
  };
  page.on('response', handler);

  // Navigate fresh so tab state resets
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  try {
    await page.locator(`text=${tabLabel}`).first().click();
  } catch (e: any) {
    console.log(`   ! could not click "${tabLabel}" tab: ${e.message}`);
    page.off('response', handler);
    return null;
  }
  await page.waitForTimeout(2500);

  await fillFn();
  await page.waitForTimeout(800);

  const clicked = await forceClickSearch(page);
  console.log(`   search clicked=${clicked}`);

  // Wait for response
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline && !body) await page.waitForTimeout(300);

  page.off('response', handler);

  fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(body, null, 2));

  if (!body) {
    console.log('   (no body captured)');
    return null;
  }

  // Summarize returned fields
  const itemRows = body?.searchResult?.itemRows || [];
  const headerFields = body?.searchResult?.headerFields || [];
  console.log(`   response: itemRows=${itemRows.length}, headerFields=${headerFields.length}`);

  const fieldKeys = new Set<string>();
  for (const h of headerFields) if (h.fieldKey) fieldKeys.add(h.fieldKey);
  for (const row of itemRows) {
    for (const f of row.itemFields || []) if (f.fieldKey) fieldKeys.add(f.fieldKey);
  }
  console.log(`   unique field keys (${fieldKeys.size}): ${Array.from(fieldKeys).sort().join(', ')}`);

  return { body, fieldKeys: Array.from(fieldKeys).sort() };
}

async function main() {
  const outDir = `/tmp/portal-alt-search/${Date.now()}`;
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`→ artifacts: ${outDir}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Search 1: License Plate (control — what we already scrape)
  const lp = await runSearch(page, 'License Plate', async () => {
    await setInputByLabel(page, 'License Plate', 'FJ86396');
    await setInputByLabel(page, 'Last Name', 'Bee');
    // state select
    await page.evaluate(() => {
      for (const sel of Array.from(document.querySelectorAll('select'))) {
        const label = sel.closest('.form-group')?.querySelector('label')?.textContent?.trim() || '';
        if (/state/i.test(label)) {
          for (let i = 0; i < sel.options.length; i++) {
            if (sel.options[i].value === 'IL' || sel.options[i].text === 'IL') {
              sel.selectedIndex = i;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              return;
            }
          }
        }
      }
    });
  }, outDir, 'license-plate-search');

  // Search 2: Ticket Number (only requires the 10-digit ticket number)
  const tn = await runSearch(page, 'Ticket Number', async () => {
    await setInputByLabel(page, 'Ticket Number', TICKET_NUMBER);
  }, outDir, 'ticket-number-search');

  // Diff the field-key sets
  if (lp && tn) {
    const lpSet = new Set(lp.fieldKeys);
    const tnSet = new Set(tn.fieldKeys);
    const onlyInTn = tn.fieldKeys.filter(k => !lpSet.has(k));
    const onlyInLp = lp.fieldKeys.filter(k => !tnSet.has(k));
    console.log('\n━━━ DIFF ━━━');
    console.log('Only in Ticket-Number search:', onlyInTn.length ? onlyInTn.join(', ') : '(none)');
    console.log('Only in License-Plate search:', onlyInLp.length ? onlyInLp.join(', ') : '(none)');

    // Grep both raw bodies for anything that looks like an address
    const scanForAddress = (name: string, json: any) => {
      const text = JSON.stringify(json);
      const candidates = ['address', 'Address', 'location', 'Location', 'street', 'Street', 'officer', 'Officer', 'photo', 'Photo', 'image', 'Image'];
      const hits: string[] = [];
      for (const c of candidates) {
        const idx = text.indexOf(c);
        if (idx === -1) continue;
        const ctx = text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + 60));
        hits.push(`  ${c}: ${ctx}`);
      }
      if (hits.length) {
        console.log(`\n${name} — contextual mentions of address-like tokens:`);
        for (const h of hits) console.log(h);
      } else {
        console.log(`\n${name} — no address-like tokens found in response body`);
      }
    };
    scanForAddress('License-Plate response', lp.body);
    scanForAddress('Ticket-Number response', tn.body);
  }

  await browser.close();
  console.log(`\n✓ done. full JSON responses in ${outDir}`);
}

main().catch(e => { console.error(e); process.exit(1); });
