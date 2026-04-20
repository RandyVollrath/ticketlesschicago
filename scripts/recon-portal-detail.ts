#!/usr/bin/env npx tsx
/**
 * Reconnaissance: discover what data the CHI PAY portal exposes on the
 * ticket detail page vs. the search results page.
 *
 * Mirrors the production scraper's exact form-fill + force-click approach
 * (see lib/chicago-portal-scraper.ts) so we actually get a real search
 * result, then clicks into the first ticket and logs every API endpoint
 * fired afterwards.
 *
 * Output: /tmp/portal-recon/{timestamp}/ with api-hits.json, detail-page.html,
 * and screenshots.
 *
 * Run: npx tsx scripts/recon-portal-detail.ts  (defaults to Travis Bee's plate)
 */

import { chromium, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';
const PLATE = process.env.RECON_PLATE || 'FJ86396';
const STATE = process.env.RECON_STATE || 'IL';
const LAST_NAME = process.env.RECON_LAST_NAME || 'Bee';

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
          if (select.options[i].value === value || select.options[i].text === value || select.options[i].value.toUpperCase() === value.toUpperCase()) {
            select.selectedIndex = i;
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
  return page.evaluate(() => {
    const btns = document.querySelectorAll('button.btn.btn-primary');
    for (const btn of btns) {
      if (btn.textContent?.trim() === 'Search') {
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

async function main() {
  const outDir = `/tmp/portal-recon/${Date.now()}`;
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`→ writing recon artifacts to ${outDir}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  // Log every API response
  const apiHits: Array<{ when: string; method: string; url: string; status: number; body?: any; reqBody?: any }> = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (!url.includes('chicago.gov') || /\.(js|css|png|svg|woff|ico|jpg|ttf)($|\?)/i.test(url)) return;
    const record: any = { when: new Date().toISOString(), method: resp.request().method(), url, status: resp.status() };
    try {
      const postData = resp.request().postData();
      if (postData) {
        try { record.reqBody = JSON.parse(postData); } catch { record.reqBody = postData.slice(0, 800); }
      }
    } catch {}
    try {
      const text = await resp.text();
      if (text.length < 50_000) {
        try { record.body = JSON.parse(text); } catch { record.body = text.slice(0, 3000); }
      } else {
        record.body = `(${text.length} bytes — too large)`;
      }
    } catch {}
    apiHits.push(record);
  });

  console.log('→ opening portal');
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  console.log('→ clicking License Plate tab');
  await page.locator('text=License Plate').first().click();
  await page.waitForTimeout(3000);

  console.log('→ filling form (plate=' + PLATE + ', state=' + STATE + ', last=' + LAST_NAME + ')');
  const fp = await fillFormField(page, 'License Plate', PLATE);
  const fn = await fillFormField(page, 'Last Name', LAST_NAME);
  const fs2 = await selectDropdownValue(page, 'State', STATE);
  console.log('   plate=' + fp + ' last=' + fn + ' state=' + fs2);
  await page.waitForTimeout(1000);

  console.log('→ force-clicking Search');
  const clicked = await forceClickSearch(page);
  console.log('   clicked=' + clicked);

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (apiHits.some(h => /\/payments-web\/api\/searches/.test(h.url) && h.method === 'POST' && h.status > 0)) break;
    await page.waitForTimeout(500);
  }

  const searchHits = apiHits.filter(h => /\/payments-web\/api\/searches/.test(h.url));
  console.log(`→ search API hits: ${searchHits.length}`);
  for (const h of searchHits) console.log(`   ${h.method} ${h.url} → ${h.status}`);

  await page.screenshot({ path: path.join(outDir, '1-search-results.png'), fullPage: true });
  fs.writeFileSync(path.join(outDir, 'search-results.html'), await page.content());

  const preDetailCount = apiHits.length;

  // Click the first ticket link/row. The CHI PAY UI uses Angular Material
  // tables — the clickable row is typically `mat-row` with a link inside.
  console.log('→ attempting to click first ticket detail link');
  let clickedDetail = false;

  // Try in order: an explicit ticket-number link, any link in tbody, then row click.
  const selectors = [
    'table a[href]',
    'tbody a',
    'a:has-text("Ticket")',
    'tr a',
    'mat-cell a',
    'tbody tr',
    'mat-row',
  ];
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        await loc.click({ timeout: 3000 });
        console.log('   → clicked selector: ' + sel);
        clickedDetail = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (clickedDetail) {
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(outDir, '2-detail-page.png'), fullPage: true });
    fs.writeFileSync(path.join(outDir, 'detail-page.html'), await page.content());
  } else {
    console.log('   ! no detail link clicked — search results may have been empty');
  }

  const newHits = apiHits.slice(preDetailCount);
  console.log(`→ ${newHits.length} API calls fired after detail click:`);
  for (const h of newHits) console.log(`   ${h.method} ${h.url} → ${h.status}`);

  // Phase 2 of recon: check a ticket, click Continue to advance past Step 2
  // (Amount to Pay) into Step 3 (Cart) — cart pages sometimes expose
  // additional receivable detail not present in the list view.
  console.log('→ Phase 2: checking first ticket checkbox + clicking Continue');
  const preContinueCount = apiHits.length;
  try {
    // Check all ticket checkboxes
    await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      boxes.forEach(b => {
        const input = b as HTMLInputElement;
        if (!input.checked) { input.click(); }
      });
    });
    await page.waitForTimeout(1500);

    // Click Continue button
    const continued = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const cont = btns.find(b => /continue/i.test(b.textContent || ''));
      if (cont) { (cont as HTMLButtonElement).disabled = false; (cont as HTMLButtonElement).click(); return true; }
      return false;
    });
    console.log('   continue clicked=' + continued);
    await page.waitForTimeout(6000);
    await page.screenshot({ path: path.join(outDir, '3-cart-page.png'), fullPage: true });
    fs.writeFileSync(path.join(outDir, 'cart-page.html'), await page.content());
  } catch (e: any) {
    console.log('   continue step failed:', e.message);
  }

  const continueHits = apiHits.slice(preContinueCount);
  console.log(`→ ${continueHits.length} API calls fired after Continue click:`);
  for (const h of continueHits) console.log(`   ${h.method} ${h.url} → ${h.status}`);

  // Phase 3: probe likely detail endpoints directly using the receivable
  // ID discovered in the search response (e.g. "tk:9306367440").
  console.log('→ Phase 3: probing common detail API endpoints by receivable ID');
  const searchBody = apiHits.find(h => /\/api\/searches/.test(h.url) && h.method === 'POST')?.body;
  const itemRows = searchBody?.searchResult?.itemRows || [];
  const firstId = itemRows[0]?.itemFields?.find((f: any) => f.fieldKey === 'id')?.fieldValue;
  console.log('   first receivable id:', firstId);
  if (firstId) {
    const probes = [
      `/payments-web/api/receivables/${firstId}`,
      `/payments-web/api/items/${firstId}`,
      `/payments-web/api/ticketDetails?id=${encodeURIComponent(firstId)}`,
      `/payments-web/api/receivables?id=${encodeURIComponent(firstId)}`,
    ];
    for (const p of probes) {
      try {
        const resp = await page.evaluate(async (path) => {
          const r = await fetch(path, { credentials: 'include' });
          const body = await r.text();
          return { status: r.status, body: body.slice(0, 2000) };
        }, p);
        console.log(`   probe ${p} → ${resp.status}`);
        if (resp.status === 200 && resp.body.length > 10) {
          console.log('     body:', resp.body.slice(0, 400));
        }
      } catch (e: any) {
        console.log(`   probe ${p} failed:`, e.message);
      }
    }
  }

  fs.writeFileSync(path.join(outDir, 'api-hits.json'), JSON.stringify(apiHits, null, 2));
  console.log(`\n→ full api log: ${path.join(outDir, 'api-hits.json')}`);

  await browser.close();
  console.log(`✓ recon complete. Artifacts: ${outDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
