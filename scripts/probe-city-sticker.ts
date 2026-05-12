// Companion to scripts/probe-ilsos-renewal.ts — load EzBuy vehicle-stickers
// landing, dump the form, screenshot. No auth needed. Stops at the very
// first page.

import { chromium } from 'playwright';

const URL = 'https://ezbuy.chicityclerk.com/vehicle-stickers';

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

  console.log(`Loading ${URL}`);
  const resp = await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  console.log(`HTTP ${resp?.status()}`);

  await page.waitForTimeout(2000);
  console.log('Title:', await page.title());

  const buttons = await page.$$eval('button, input[type="submit"]', (els) =>
    els.map((e) => ({
      text: (e as HTMLElement).textContent?.trim() || (e as HTMLInputElement).value || null,
      id: e.id || null,
    })),
  );
  console.log('\nButtons:', JSON.stringify(buttons, null, 2));

  await page.screenshot({ path: '/tmp/city-sticker-landing.png', fullPage: true });
  console.log('Screenshot: /tmp/city-sticker-landing.png');

  await browser.close();
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
