/**
 * Camera-ticket evidence scraper.
 *
 * Pulls violation photos and video for red-light and speed-camera tickets
 * from the City of Chicago's vendor-run evidence portals:
 *
 *   - Red light:    https://www.chicagophotociteweb.com/publicinq/
 *   - Speed camera: https://www.violationinfo.com/Chicago/
 *
 * Both portals are public, no auth, no captcha. They accept a citation
 * number + license plate and serve back violation imagery + video.
 *
 * Probe history (2026-05-10):
 *   - chicagophotociteweb.com runs IIS w/ classic ASP (chicagodefault.asp →
 *     CHDetails.asp). Requires browser-set Content-Length, which is why
 *     this code uses Playwright rather than raw HTTP.
 *   - violationinfo.com is ASP.NET WebForms (__VIEWSTATE, __EVENTVALIDATION).
 *     Also Playwright.
 *
 * The scraper:
 *   1. Navigates to the portal
 *   2. Fills citation + plate
 *   3. Submits the form
 *   4. Collects all media URLs and downloads them
 *   5. Returns the artifacts as buffers (caller decides where to persist)
 *
 * No DB writes here — this is a pure fetcher. Storage lives in the caller.
 */

import { chromium, type Browser, type Page, type Response } from 'playwright';

export interface CameraEvidence {
  /** Citation number that was looked up */
  citation: string;
  /** Plate that was looked up */
  plate: string;
  /** Detected violation type from the portal source */
  source: 'red_light' | 'speed_camera' | 'parking_photo';
  /** URLs the portal served — already proxied through the vendor's CDN */
  imageUrls: string[];
  /** Video URLs (mp4 / wmv / asx). Often only one. */
  videoUrls: string[];
  /** Raw image bytes, keyed by source URL */
  images: Array<{ url: string; bytes: Buffer; contentType: string }>;
  /** Raw video bytes, keyed by source URL */
  videos: Array<{ url: string; bytes: Buffer; contentType: string }>;
  /** Diagnostics for debugging when the portal returns no media */
  notes: string[];
  /** When the scrape ran */
  scrapedAt: string;
}

const PORTAL_LOAD_TIMEOUT = 45_000;
const FORM_SETTLE_MS = 1_500;
const POST_SUBMIT_WAIT_MS = 6_000;
const MEDIA_DOWNLOAD_TIMEOUT = 30_000;

/**
 * Scrape red-light camera evidence from chicagophotociteweb.com.
 */
export async function scrapeRedLightEvidence(
  citation: string,
  plate: string,
  options?: { browser?: Browser; screenshotDir?: string },
): Promise<CameraEvidence> {
  const out: CameraEvidence = {
    citation,
    plate,
    source: 'red_light',
    imageUrls: [],
    videoUrls: [],
    images: [],
    videos: [],
    notes: [],
    scrapedAt: new Date().toISOString(),
  };

  let browser = options?.browser ?? null;
  let ownsBrowser = false;
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    ownsBrowser = true;
  }

  try {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    const mediaResponses = collectMediaResponses(page);

    await page.goto('https://www.chicagophotociteweb.com/publicinq/', {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_LOAD_TIMEOUT,
    });
    await page.waitForTimeout(FORM_SETTLE_MS);

    // Fill the form. Vendor uses classic ASP, names are stable.
    await page.fill('input[name="Citation"]', citation);
    await page.fill('input[name="LicensePlate"]', plate);
    await page.waitForTimeout(500);

    // Submit. The form posts to chicagodefault.asp which 302's to CHDetails.asp.
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: PORTAL_LOAD_TIMEOUT }).catch(() => {}),
      page.click('input[name="btnSubmit"]'),
    ]);
    await page.waitForTimeout(POST_SUBMIT_WAIT_MS);

    if (options?.screenshotDir) {
      await page.screenshot({ path: `${options.screenshotDir}/red-light-${citation}.png`, fullPage: true }).catch(() => {});
    }

    // Detect "no match" / "violation not found" responses early.
    const bodyText = (await page.evaluate(() => document.body.innerText || '')).toLowerCase();
    if (/not\s+found|does\s+not\s+match|invalid|error/i.test(bodyText) && !bodyText.includes('violation video')) {
      out.notes.push('Red-light portal returned no-match / error');
      return out;
    }

    // Collect media URLs from the DOM and from network log
    const dom = await page.evaluate(() => ({
      images: Array.from(document.images)
        .map(i => i.src)
        .filter(s => !!s && !s.startsWith('data:') && !/\.svg/i.test(s)),
      videos: Array.from(document.querySelectorAll('video, source, embed, object'))
        .map(el => (el as HTMLVideoElement).src || el.getAttribute('src') || el.getAttribute('data') || '')
        .filter(Boolean),
      iframes: Array.from(document.querySelectorAll('iframe')).map(f => f.src).filter(Boolean),
      videoHrefs: Array.from(document.querySelectorAll('a'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(h => /\.(mp4|wmv|asf|asx|avi|m4v|webm|mov)(\?|$)/i.test(h)),
    }));

    out.imageUrls = dedupe([
      ...dom.images.filter(isViolationImage),
      ...mediaResponses.images,
    ]);
    out.videoUrls = dedupe([
      ...dom.videos.filter(isVideoLike),
      ...dom.videoHrefs,
      ...mediaResponses.videos,
    ]);

    if (out.imageUrls.length === 0 && out.videoUrls.length === 0) {
      out.notes.push(`Red-light portal returned no media. Page text: ${bodyText.slice(0, 200)}`);
      return out;
    }

    for (const url of out.imageUrls) {
      const fetched = await fetchInContext(page, url);
      if (fetched && isViolationImageByBytes(fetched.bytes, fetched.contentType, fetched.url)) {
        out.images.push(fetched);
      }
    }
    for (const url of out.videoUrls) {
      const fetched = await fetchInContext(page, url);
      if (fetched) out.videos.push(fetched);
    }
    // Drop UI-chrome URLs from the public list too, so callers don't show them
    out.imageUrls = out.images.map(i => i.url);
  } finally {
    if (ownsBrowser && browser) await browser.close().catch(() => {});
  }

  return out;
}

/**
 * Scrape speed-camera evidence from violationinfo.com/Chicago/.
 */
export async function scrapeSpeedCameraEvidence(
  citation: string,
  plate: string,
  options?: { browser?: Browser; screenshotDir?: string },
): Promise<CameraEvidence> {
  const out: CameraEvidence = {
    citation,
    plate,
    source: 'speed_camera',
    imageUrls: [],
    videoUrls: [],
    images: [],
    videos: [],
    notes: [],
    scrapedAt: new Date().toISOString(),
  };

  let browser = options?.browser ?? null;
  let ownsBrowser = false;
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    ownsBrowser = true;
  }

  try {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    const mediaResponses = collectMediaResponses(page);

    await page.goto('https://www.violationinfo.com/Chicago/', {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_LOAD_TIMEOUT,
    });
    await page.waitForTimeout(FORM_SETTLE_MS);

    // ASP.NET WebForms — fields are CitationNumber + LicensePlate
    await page.fill('input[name="CitationNumber"]', citation);
    await page.fill('input[name="LicensePlate"]', plate);
    await page.waitForTimeout(500);

    // The submit button is the page's primary form button. Resolve by text.
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: PORTAL_LOAD_TIMEOUT }).catch(() => {}),
      page.click('input[type="submit"], button[type="submit"]'),
    ]);
    await page.waitForTimeout(POST_SUBMIT_WAIT_MS);

    if (options?.screenshotDir) {
      await page.screenshot({ path: `${options.screenshotDir}/speed-cam-${citation}.png`, fullPage: true }).catch(() => {});
    }

    const bodyText = (await page.evaluate(() => document.body.innerText || '')).toLowerCase();
    if (/not\s+found|does\s+not\s+match|invalid|no\s+record/i.test(bodyText) && !bodyText.includes('violation')) {
      out.notes.push('Speed-camera portal returned no-match / error');
      return out;
    }

    const dom = await page.evaluate(() => ({
      images: Array.from(document.images).map(i => i.src).filter(s => !!s && !s.startsWith('data:') && !/\.svg/i.test(s)),
      videos: Array.from(document.querySelectorAll('video, source, embed, object'))
        .map(el => (el as HTMLVideoElement).src || el.getAttribute('src') || el.getAttribute('data') || '')
        .filter(Boolean),
      videoHrefs: Array.from(document.querySelectorAll('a'))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(h => /\.(mp4|wmv|asf|asx|avi|m4v|webm|mov)(\?|$)/i.test(h)),
    }));

    out.imageUrls = dedupe([
      ...dom.images.filter(isViolationImage),
      ...mediaResponses.images,
    ]);
    out.videoUrls = dedupe([
      ...dom.videos.filter(isVideoLike),
      ...dom.videoHrefs,
      ...mediaResponses.videos,
    ]);

    if (out.imageUrls.length === 0 && out.videoUrls.length === 0) {
      out.notes.push(`Speed-camera portal returned no media. Page text: ${bodyText.slice(0, 200)}`);
      return out;
    }

    for (const url of out.imageUrls) {
      const fetched = await fetchInContext(page, url);
      if (fetched) out.images.push(fetched);
    }
    for (const url of out.videoUrls) {
      const fetched = await fetchInContext(page, url);
      if (fetched) out.videos.push(fetched);
    }
  } finally {
    if (ownsBrowser && browser) await browser.close().catch(() => {});
  }

  return out;
}

/**
 * Scrape parking-ticket photo (Smart Streets Pilot) from
 * parkingticketimage.chicago.gov. Most parking tickets do NOT have photos
 * — this returns an empty result for them.
 */
export async function scrapeParkingPhoto(
  citation: string,
  plate: string,
  options?: { browser?: Browser; screenshotDir?: string },
): Promise<CameraEvidence> {
  const out: CameraEvidence = {
    citation,
    plate,
    source: 'parking_photo',
    imageUrls: [],
    videoUrls: [],
    images: [],
    videos: [],
    notes: [],
    scrapedAt: new Date().toISOString(),
  };

  let browser = options?.browser ?? null;
  let ownsBrowser = false;
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    });
    ownsBrowser = true;
  }

  try {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      acceptDownloads: true,
      ignoreHTTPSErrors: true,
    });
    const page = await ctx.newPage();

    const mediaResponses = collectMediaResponses(page);

    await page.goto('https://parkingticketimage.chicago.gov/pbw/include/chicago/ChicagoImages.jsp', {
      waitUntil: 'domcontentloaded',
      timeout: PORTAL_LOAD_TIMEOUT,
    });
    await page.waitForTimeout(FORM_SETTLE_MS);

    await page.fill('input[name="ticket"]', citation);
    await page.fill('input[name="plate"]', plate);
    await page.waitForTimeout(500);

    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: PORTAL_LOAD_TIMEOUT }).catch(() => {}),
      page.click('input[name="submit"]'),
    ]);
    await page.waitForTimeout(POST_SUBMIT_WAIT_MS);

    if (options?.screenshotDir) {
      await page.screenshot({ path: `${options.screenshotDir}/parking-photo-${citation}.png`, fullPage: true }).catch(() => {});
    }

    const bodyText = (await page.evaluate(() => document.body.innerText || '')).toLowerCase();
    if (/does\s+not\s+match|not all violations|no.*photo/i.test(bodyText)) {
      out.notes.push('Parking-photo portal: no photo on file (most parking tickets do not have photos)');
      return out;
    }

    const dom = await page.evaluate(() => ({
      images: Array.from(document.images).map(i => i.src).filter(s => !!s && !s.startsWith('data:') && !/\.svg/i.test(s)),
    }));
    out.imageUrls = dedupe([...dom.images.filter(isViolationImage), ...mediaResponses.images]);

    for (const url of out.imageUrls) {
      const fetched = await fetchInContext(page, url);
      if (fetched && isViolationImageByBytes(fetched.bytes, fetched.contentType, fetched.url)) {
        out.images.push(fetched);
      }
    }
    out.imageUrls = out.images.map(i => i.url);
  } finally {
    if (ownsBrowser && browser) await browser.close().catch(() => {});
  }

  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function isViolationImage(url: string): boolean {
  if (!/\.(jpg|jpeg|png|gif|tiff?)(\?|$)/i.test(url)) return false;

  // Strip query, grab the filename portion of the URL path
  const pathOnly = url.split('?')[0];
  const filename = pathOnly.split('/').pop()?.toLowerCase() || '';

  // Vendor chrome — match anywhere in the filename, not just at the start.
  // Caught here: city-of-chicago-logo.png, nav_home.gif, body-bg.jpg,
  // valid.png, spinner.gif, header.png, footer.png, etc.
  const chromeKeywords = [
    'logo', 'nav_', 'body-bg', 'body_bg', 'page-bg', 'page_bg',
    'header', 'footer', 'spinner', 'loading', 'background',
    'seal', 'icon', 'arrow', 'button', 'bg.',
  ];
  if (chromeKeywords.some(k => filename.includes(k))) return false;
  if (filename === 'valid.png' || filename === 'cleardot.gif') return false;

  // Real violation images on chicagophotociteweb live under /assetapi/...
  // and on violationinfo.com under similar paths. The byte-size filter
  // (isViolationImageByBytes) catches anything that slips through here.
  return true;
}

/**
 * Post-download filter: real violation photos are large (typ. 100KB+).
 * Drops anything that snuck through as "image but probably chrome".
 *
 * Special-case: small images served from the vendor's `/assetapi/` path
 * (e.g. `02042026_130531_1251_4_4_3_1i5.jpg` at 404x312, 12KB) are
 * legitimate plate close-ups generated by the camera vendor. Keep them.
 */
function isViolationImageByBytes(bytes: Buffer, contentType: string, url?: string): boolean {
  if (!contentType.startsWith('image/')) return false;
  if (/svg|gif/i.test(contentType)) return false;
  // Vendor-served assets are real evidence even if small (plate crops, etc.)
  if (url && /\/assetapi\//i.test(url)) return bytes.length >= 1_000;
  // Anything else under 20KB is almost certainly a UI element.
  return bytes.length >= 20_000;
}

function isVideoLike(url: string): boolean {
  return /\.(mp4|wmv|asf|asx|avi|m4v|webm|mov)(\?|$)/i.test(url);
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function collectMediaResponses(page: Page): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];
  page.on('response', (resp: Response) => {
    const url = resp.url();
    const ct = (resp.headers()['content-type'] || '').toLowerCase();
    if (ct.startsWith('image/') && !/svg|gif/.test(ct) && isViolationImage(url)) {
      images.push(url);
    }
    if (ct.startsWith('video/') || isVideoLike(url)) {
      videos.push(url);
    }
  });
  return { images, videos };
}

async function fetchInContext(
  page: Page,
  url: string,
): Promise<{ url: string; bytes: Buffer; contentType: string } | null> {
  try {
    const resp = await page.context().request.get(url, { timeout: MEDIA_DOWNLOAD_TIMEOUT });
    if (!resp.ok()) return null;
    const bytes = Buffer.from(await resp.body());
    const contentType = resp.headers()['content-type'] || 'application/octet-stream';
    return { url, bytes, contentType };
  } catch {
    return null;
  }
}

/**
 * Dispatch by violation type. Returns null if not a camera ticket.
 */
export async function scrapeCameraEvidence(
  violationType: string | null,
  violationCode: string | null,
  citation: string,
  plate: string,
  options?: { browser?: Browser; screenshotDir?: string },
): Promise<CameraEvidence | null> {
  const t = (violationType || '').toLowerCase();
  const c = (violationCode || '').toLowerCase();
  if (t === 'red_light' || c.startsWith('9-102-010')) {
    return scrapeRedLightEvidence(citation, plate, options);
  }
  if (t === 'speed_camera' || c.startsWith('9-101-020')) {
    return scrapeSpeedCameraEvidence(citation, plate, options);
  }
  return null;
}
