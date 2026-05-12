// Daily sentinel probe for both renewal entry pages.
// - IL SOS LicenseRenewal: confirm Akamai isn't blocking, #regId + #pin exist
// - Chicago EzBuy vehicle-stickers: confirm Next button present on landing
//
// If either breaks, alert randyvollrath@gmail.com via Resend so we catch
// selector / bot-wall drift BEFORE a real user's renewal fails on it.
//
// Authentication: same x-vercel-cron header check as other crons.

import type { NextApiRequest, NextApiResponse } from 'next';
import { chromium, Browser } from 'playwright';
import { sendRenewalOperatorAlert } from '../../../lib/renewal-alerts';

const IL_URL = 'https://apps.ilsos.gov/LicenseRenewal/';
const CITY_URL = 'https://ezbuy.chicityclerk.com/vehicle-stickers';

async function newStealthBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
}

async function probeIlEntry(): Promise<{ ok: boolean; reason?: string }> {
  const browser = await newStealthBrowser();
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/Chicago',
    });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    const page = await ctx.newPage();
    const resp = await page.goto(IL_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const status = resp?.status() ?? 0;
    if (status >= 400) return { ok: false, reason: `Akamai or upstream returned HTTP ${status}` };
    await page.waitForTimeout(2000);
    const regId = await page.$('#regId');
    const pin = await page.$('#pin');
    if (!regId || !pin) return { ok: false, reason: 'Entry form selectors #regId or #pin missing' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `exception: ${e?.message || String(e)}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function probeCityEntry(): Promise<{ ok: boolean; reason?: string }> {
  const browser = await newStealthBrowser();
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/Chicago',
    });
    await ctx.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));
    const page = await ctx.newPage();
    const resp = await page.goto(CITY_URL, { waitUntil: 'networkidle', timeout: 30000 });
    const status = resp?.status() ?? 0;
    if (status >= 400) return { ok: false, reason: `HTTP ${status}` };
    await page.waitForTimeout(1500);
    const next = await page.$('button:has-text("Next")');
    if (!next) return { ok: false, reason: 'Landing-page Next button missing' };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: `exception: ${e?.message || String(e)}` };
  } finally {
    await browser.close().catch(() => {});
  }
}

function isAuthorizedCron(req: NextApiRequest): boolean {
  if (req.headers['x-vercel-cron']) return true;
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${process.env.CRON_SECRET}`) return true;
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'unauthorized' });

  const [il, city] = await Promise.all([probeIlEntry(), probeCityEntry()]);

  const failures: string[] = [];
  if (!il.ok) failures.push(`IL SOS entry: ${il.reason}`);
  if (!city.ok) failures.push(`Chicago EzBuy entry: ${city.reason}`);

  if (failures.length) {
    await sendRenewalOperatorAlert({
      subject: 'Sentinel probe FAILED',
      severity: 'warning',
      body: [
        'Daily sentinel probe detected a problem with one or both renewal entry pages.',
        '',
        ...failures,
        '',
        'Diagnose by running:',
        '  npx tsx scripts/probe-ilsos-renewal.ts',
        '  (and a similar EzBuy probe if needed)',
        '',
        'The cron has continued; per-renewal-type circuit breakers will trip',
        'separately if real renewals start failing.',
      ].join('\n'),
    });
  }

  return res.status(200).json({
    ok: failures.length === 0,
    probes: { il, city },
    failures,
  });
}
