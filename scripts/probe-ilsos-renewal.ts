// One-off probe: what does apps.ilsos.gov/LicenseRenewal/ ask for?
// Goal: confirm whether the online path is PIN-only or accepts plate + VIN.
// Reads NOTHING from secrets, submits NOTHING. Loads, screenshots, dumps fields.

import { chromium } from 'playwright';

const URL = 'https://apps.ilsos.gov/LicenseRenewal/';

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

  // Remove the webdriver flag that Akamai uses to fingerprint headless browsers.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const page = await context.newPage();

  console.log(`Loading ${URL} ...`);
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  console.log(`HTTP ${resp?.status()} ${resp?.statusText()}`);

  await page.waitForTimeout(3000);

  const title = await page.title();
  const url = page.url();
  console.log(`Title: ${title}`);
  console.log(`Final URL: ${url}`);

  const bodyText = (await page.evaluate(() => document.body?.innerText ?? '')).slice(0, 2000);
  console.log('\n--- BODY TEXT (first 2KB) ---');
  console.log(bodyText);
  console.log('--- END BODY ---\n');

  const fields = await page.$$eval('input, select, textarea', (els) =>
    els.map((el) => {
      const e = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      const id = e.id || null;
      const name = (e as HTMLInputElement).name || null;
      const type = (e as HTMLInputElement).type || e.tagName.toLowerCase();
      const placeholder = (e as HTMLInputElement).placeholder || null;
      const aria = e.getAttribute('aria-label');
      let labelText: string | null = null;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText = lbl.textContent?.trim() || null;
      }
      return { id, name, type, placeholder, aria, labelText };
    })
  );
  console.log('--- FORM FIELDS ---');
  console.log(JSON.stringify(fields, null, 2));

  const captcha = await page.evaluate(() => {
    const markers = [
      'g-recaptcha',
      'h-captcha',
      'cf-turnstile',
      'recaptcha',
      'hcaptcha',
      'turnstile',
    ];
    const html = document.documentElement.outerHTML.toLowerCase();
    return markers.filter((m) => html.includes(m));
  });
  console.log('--- CAPTCHA MARKERS FOUND ---');
  console.log(captcha.length ? captcha.join(', ') : '(none)');

  await page.screenshot({ path: '/tmp/ilsos-renewal-entry.png', fullPage: true });
  console.log('\nScreenshot: /tmp/ilsos-renewal-entry.png');

  await browser.close();
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exit(1);
});
