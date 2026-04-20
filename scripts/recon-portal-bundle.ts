#!/usr/bin/env npx tsx
/**
 * Reconnaissance #2: read the CHI PAY Angular frontend bundle to discover
 * every field key the API can possibly return — without needing a live
 * ticket to test against. This answers the question "does the portal ever
 * expose the violation address, even if Travis's aged Determination tickets
 * don't" by looking at what fields the frontend is wired to render.
 *
 * Method:
 *   1. Load the portal in Playwright.
 *   2. Intercept every response — collect the text of all .js bundles.
 *   3. Grep those bundles for candidate field keys and UI labels:
 *        - "Location", "Address", "Street", "Officer", "Badge", "Photo",
 *          "Image", "Violation Code", "Issuing Agency", "Hearing Location"
 *        - "fieldKey", "fieldDescription"
 *   4. Also enumerate every known field-key reference we find (e.g.
 *      "Date Issued", "Hearing Start Date") and report them back.
 *
 * Saves results to /tmp/portal-bundle-recon/{timestamp}/
 *
 * Run: npx tsx scripts/recon-portal-bundle.ts
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

const CANDIDATE_FIELDS = [
  'Address', 'address',
  'Location', 'location',
  'Street', 'street',
  'Block', 'block',
  'Officer', 'officer',
  'Badge', 'badge',
  'Photo', 'photo',
  'Image', 'image',
  'Violation Code', 'violation_code', 'violationCode',
  'Issuing Agency', 'issuingAgency', 'issuing_agency',
  'Hearing Location',
  'Vehicle Make', 'vehicleMake',
  'Vehicle Model', 'vehicleModel',
  'Vehicle Color', 'vehicleColor',
  'Issue Time', 'issueTime',
  'Where Issued',
  'Violation Address',
];

async function main() {
  const outDir = `/tmp/portal-bundle-recon/${Date.now()}`;
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`→ artifacts: ${outDir}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  const bundles: Array<{ url: string; size: number; path: string }> = [];

  page.on('response', async (resp) => {
    const url = resp.url();
    if (!url.endsWith('.js') || !url.includes('chicago.gov')) return;
    try {
      const text = await resp.text();
      const safeName = url.split('/').pop()!.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
      const filePath = path.join(outDir, safeName);
      fs.writeFileSync(filePath, text);
      bundles.push({ url, size: text.length, path: filePath });
      console.log(`   downloaded ${safeName} (${text.length} bytes)`);
    } catch (e: any) {
      console.log(`   failed to read ${url}: ${e.message}`);
    }
  });

  console.log('→ loading portal to pull JS bundles');
  await page.goto(PORTAL_URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Click License Plate tab so any lazy-loaded chunks also download
  try {
    await page.locator('text=License Plate').first().click({ timeout: 3000 });
    await page.waitForTimeout(3000);
  } catch { /* ignore */ }

  await browser.close();

  console.log(`\n→ collected ${bundles.length} JS bundle(s), total ${bundles.reduce((a, b) => a + b.size, 0)} bytes\n`);

  // Grep every bundle for candidate field mentions
  const findings: Record<string, Array<{ bundle: string; contexts: string[] }>> = {};
  for (const field of CANDIDATE_FIELDS) findings[field] = [];

  for (const b of bundles) {
    const text = fs.readFileSync(b.path, 'utf8');
    const short = b.url.split('/').pop()!;
    for (const field of CANDIDATE_FIELDS) {
      // Exact-string search (avoids false-positive regex matches in minified code)
      let idx = 0;
      const contexts: string[] = [];
      while (contexts.length < 3) {
        const pos = text.indexOf(field, idx);
        if (pos === -1) break;
        // Only keep "field-like" hits — quoted strings or property accesses
        const before = text.charAt(pos - 1);
        const after = text.charAt(pos + field.length);
        const isQuoted = before === '"' || before === "'" || before === '`';
        const isDotAccess = before === '.' && /[A-Za-z0-9_]/.test(after || '_');
        if (isQuoted || isDotAccess) {
          const ctxStart = Math.max(0, pos - 50);
          const ctxEnd = Math.min(text.length, pos + field.length + 50);
          contexts.push(text.slice(ctxStart, ctxEnd).replace(/\s+/g, ' '));
        }
        idx = pos + field.length;
      }
      if (contexts.length) findings[field].push({ bundle: short, contexts });
    }
  }

  // Also enumerate every distinct "fieldKey": "..." literal we see — this
  // shows the full universe of field keys the frontend knows about.
  const fieldKeys = new Set<string>();
  for (const b of bundles) {
    const text = fs.readFileSync(b.path, 'utf8');
    const re = /fieldKey['"]?\s*:\s*['"]([^'"]{1,50})['"]/g;
    let m;
    while ((m = re.exec(text)) !== null) fieldKeys.add(m[1]);
  }

  console.log('═══ CANDIDATE FIELD FINDINGS ═══');
  for (const field of CANDIDATE_FIELDS) {
    const hits = findings[field];
    const total = hits.reduce((a, h) => a + h.contexts.length, 0);
    if (total === 0) continue;
    console.log(`\n• "${field}" — ${total} hit(s) across ${hits.length} bundle(s)`);
    for (const h of hits) {
      for (const ctx of h.contexts.slice(0, 2)) {
        console.log(`    [${h.bundle}] …${ctx}…`);
      }
    }
  }

  console.log(`\n═══ ALL fieldKey LITERALS IN THE BUNDLE (${fieldKeys.size}) ═══`);
  for (const k of Array.from(fieldKeys).sort()) console.log(`   ${k}`);

  fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify({ findings, fieldKeys: Array.from(fieldKeys) }, null, 2));
  console.log(`\n✓ Full results in ${outDir}/findings.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
