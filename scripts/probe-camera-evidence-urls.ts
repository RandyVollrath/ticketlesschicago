/**
 * Probe what the Chicago payments portal shows for a camera-ticket detail.
 * We need to find: (a) where the violation photo/video URLs live, and
 * (b) whether they're reachable without auth/cookies.
 *
 * Usage: npx tsx scripts/probe-camera-evidence-urls.ts <plate> <state> <last_name>
 * Example: npx tsx scripts/probe-camera-evidence-urls.ts FA81246 IL Smith
 */

import { chromium, Page } from 'playwright';

const PORTAL_URL = 'https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1';

async function main() {
  const [plate, state, lastName] = process.argv.slice(2);
  if (!plate || !state || !lastName) {
    console.error('Usage: probe-camera-evidence-urls.ts <plate> <state> <last_name>');
    process.exit(2);
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await ctx.newPage();

  // Log every network request/response for review
  const interesting: string[] = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    const ct = resp.headers()['content-type'] || '';
    if (
      /\b(photo|image|video|jpg|jpeg|png|mp4|evidence|media|attachment|enforcement)\b/i.test(url) ||
      /\b(image|video)\b/i.test(ct)
    ) {
      interesting.push(`[${resp.status()}] ${ct} ${url}`);
    }
  });

  console.log(`→ Navigating to ${PORTAL_URL}`);
  await page.goto(PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(4_000);

  console.log('→ Clicking License Plate tab');
  await page.locator('text=License Plate').first().click();
  await page.waitForTimeout(1_500);

  console.log('→ Filling form');
  await page.locator('input').first().waitFor({ timeout: 10_000 }).catch(() => {});
  // Find inputs by label proximity
  await page.evaluate((vals: { plate: string; state: string; lastName: string }) => {
    const labels = Array.from(document.querySelectorAll('label')) as HTMLLabelElement[];
    for (const lbl of labels) {
      const text = (lbl.textContent || '').toLowerCase();
      const forId = lbl.getAttribute('for');
      const input = forId ? document.getElementById(forId) as HTMLInputElement | HTMLSelectElement : null;
      if (!input) continue;
      if (text.includes('license plate')) (input as HTMLInputElement).value = vals.plate.toUpperCase();
      else if (text.includes('last name')) (input as HTMLInputElement).value = vals.lastName;
      else if (text.includes('state') && input.tagName === 'SELECT') {
        const sel = input as HTMLSelectElement;
        for (const opt of Array.from(sel.options)) {
          if (opt.value === vals.state.toUpperCase() || (opt.textContent || '').trim() === vals.state.toUpperCase()) {
            sel.value = opt.value;
            break;
          }
        }
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { plate, state, lastName });
  await page.waitForTimeout(1_500);

  console.log('→ Submitting via Angular controller');
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
    const submit = buttons.find(b => /search/i.test(b.textContent || ''));
    if (submit) submit.click();
  });

  console.log('→ Waiting for results');
  await page.waitForTimeout(6_000);

  // Take a screenshot for visual review
  await page.screenshot({ path: '/tmp/probe-list.png', fullPage: true });
  console.log('→ Screenshot saved: /tmp/probe-list.png');

  // Look for "View Photos/Video" link or any clickable element with evidence-related text
  const evidenceLinks = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, button, [role="button"]')) as HTMLElement[];
    return all
      .filter(el => /photo|video|evidence|view|detail/i.test(el.textContent || ''))
      .map(el => ({
        text: (el.textContent || '').trim().slice(0, 80),
        tag: el.tagName,
        href: (el as HTMLAnchorElement).href || null,
        onclick: el.getAttribute('onclick'),
      }))
      .slice(0, 30);
  });
  console.log('→ Evidence-related clickables on the list page:');
  for (const e of evidenceLinks) console.log(`   ${e.tag} "${e.text}" href=${e.href}`);

  // Try clicking the first "View" / "Photos" / "Details" element
  const clickedLabel = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('a, button, [role="button"]')) as HTMLElement[];
    const target = all.find(el => /view photo|view video|view evidence|view detail|photo|video/i.test(el.textContent || ''));
    if (target) {
      target.click();
      return (target.textContent || '').trim();
    }
    return null;
  });
  console.log(`→ Clicked: ${clickedLabel || '<none — nothing matched>'}`);

  if (clickedLabel) {
    await page.waitForTimeout(5_000);
    await page.screenshot({ path: '/tmp/probe-detail.png', fullPage: true });
    console.log('→ Screenshot saved: /tmp/probe-detail.png');

    // Get all image src + video src on the page
    const media = await page.evaluate(() => ({
      images: Array.from(document.images).map(i => i.src).filter(s => !s.startsWith('data:') && !/\.svg/.test(s)),
      videos: Array.from(document.querySelectorAll('video')).flatMap(v => {
        const srcs: string[] = [];
        if (v.src) srcs.push(v.src);
        v.querySelectorAll('source').forEach(s => { if ((s as HTMLSourceElement).src) srcs.push((s as HTMLSourceElement).src); });
        return srcs;
      }),
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src),
    }));
    console.log('→ Media URLs on the detail page:');
    console.log('   Images:', JSON.stringify(media.images.slice(0, 10), null, 2));
    console.log('   Videos:', JSON.stringify(media.videos, null, 2));
    console.log('   Iframes:', JSON.stringify(media.iframes, null, 2));

    // Look for "view photos" or similar on detail
    const detailLinks = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('a, button')) as HTMLElement[];
      return all
        .filter(el => /photo|video|image|evidence/i.test(el.textContent || ''))
        .map(el => ({
          text: (el.textContent || '').trim().slice(0, 80),
          href: (el as HTMLAnchorElement).href || null,
        }))
        .slice(0, 20);
    });
    console.log('→ Evidence-related links on detail:');
    for (const l of detailLinks) console.log(`   "${l.text}" href=${l.href}`);
  }

  console.log('');
  console.log('==============================================');
  console.log('Image/video/evidence-suspicious network calls:');
  console.log('==============================================');
  for (const x of interesting) console.log(x);

  await browser.close();
}

main().catch(err => {
  console.error('Probe failed:', err);
  process.exit(1);
});
