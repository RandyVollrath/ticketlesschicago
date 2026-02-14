/**
 * Quick script to detect what captcha type the Chicago portal uses
 */
import { chromium } from 'playwright';

async function check() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  console.log('Loading portal...');
  await page.goto('https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForTimeout(5000);

  // Click License Plate tab
  const tab = page.locator('.tab, .nav-link, [role="tab"], a[class*="tab"]').filter({ hasText: /License Plate/i });
  await tab.click();
  await page.waitForTimeout(3000);

  // Take screenshot
  await page.screenshot({ path: './debug-screenshots/captcha-check.png', fullPage: true });
  console.log('Screenshot saved to ./debug-screenshots/captcha-check.png');

  // Check for captcha-related elements in HTML
  const html = await page.content();

  console.log('\n=== Captcha Detection ===');
  console.log('Has hCaptcha references:', html.includes('hcaptcha') || html.includes('h-captcha'));
  console.log('Has reCAPTCHA references:', html.includes('recaptcha') || html.includes('g-recaptcha'));
  console.log('Has Turnstile references:', html.includes('turnstile') || html.includes('cf-turnstile'));

  // Find iframes
  const iframeSrcs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => f.src || f.getAttribute('src') || '(no src)');
  });
  console.log('\nIframes found:', iframeSrcs.length);
  for (const src of iframeSrcs) {
    console.log('  iframe src:', src);
  }

  // Find scripts with captcha references
  const scriptSrcs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script[src]')).map(s => s.getAttribute('src') || '');
  });
  for (const src of scriptSrcs) {
    if (src.includes('captcha') || src.includes('recaptcha') || src.includes('hcaptcha') || src.includes('turnstile')) {
      console.log('CAPTCHA SCRIPT:', src);
    }
  }

  // Find data-sitekey elements
  const sitekeyEls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-sitekey]')).map(e => ({
      tag: e.tagName,
      className: e.className,
      sitekey: e.getAttribute('data-sitekey'),
    }));
  });
  console.log('\nElements with data-sitekey:', sitekeyEls.length);
  for (const el of sitekeyEls) {
    console.log('  ', el.tag, el.className, 'sitekey:', el.sitekey);
  }

  // Check for ng-hcaptcha Angular component
  const ngHcaptchaCount = await page.evaluate(() => {
    return document.querySelectorAll('ng-hcaptcha, [ng-hcaptcha]').length;
  });
  console.log('ng-hcaptcha elements:', ngHcaptchaCount);

  // Check for Google reCAPTCHA v2/v3 elements
  const recaptchaCount = await page.evaluate(() => {
    return document.querySelectorAll('.g-recaptcha, [data-sitekey][class*="recaptcha"], grecaptcha').length;
  });
  console.log('g-recaptcha elements:', recaptchaCount);

  // Search for sitekey in all script contents
  const inlineScripts = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('script:not([src])')).map(s => s.textContent || '');
  });
  for (const script of inlineScripts) {
    const sitekeyMatch = script.match(/sitekey['":\s]+['"]([^'"]+)['"]/i);
    if (sitekeyMatch) {
      console.log('Found sitekey in inline script:', sitekeyMatch[1]);
    }
    if (script.includes('hcaptcha') || script.includes('recaptcha')) {
      console.log('Inline script contains captcha reference (first 200):', script.substring(0, 200));
    }
  }

  // Check for the sitekey in the HTML
  const htmlSitekey = html.match(/sitekey['"=:\s]+['"]([a-f0-9-]{20,})['"]/i);
  if (htmlSitekey) {
    console.log('\nFound sitekey in HTML:', htmlSitekey[1]);
  }

  // Also check for reCAPTCHA enterprise
  console.log('\nHas reCAPTCHA enterprise:', html.includes('recaptcha/enterprise') || html.includes('grecaptcha.enterprise'));

  await browser.close();
}

check().catch(console.error);
