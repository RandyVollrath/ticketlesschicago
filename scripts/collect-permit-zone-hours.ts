#!/usr/bin/env npx ts-node
/**
 * Collect Permit Zone Hours via Street View JS API + Gemini Flash Vision (v11)
 *
 * v11 changes:
 *   - Switch to Gemini 2.0 Flash for vision analysis (free tier: 1500 RPD)
 *   - Remove broken Cloud Vision / Claude Sonnet dependencies
 *   - Smart address selection: mid-block addresses (signs are mid-block, not at intersections)
 *   - 5 addresses per zone across different streets, mixing low/mid/high positions
 *   - Shuffle segments to avoid always starting with the same streets
 *   - 6 directions at 1280x960 zoom=2, JPEG 75, 1200ms between headings
 *
 * Supports --test-batch N to run only N zones (for cost estimation)
 *
 * Usage:
 *   npx tsx scripts/collect-permit-zone-hours.ts --skip-existing
 *   npx tsx scripts/collect-permit-zone-hours.ts --zone 62
 *   npx tsx scripts/collect-permit-zone-hours.ts --dry-run
 *   npx tsx scripts/collect-permit-zone-hours.ts --report-only
 *   npx tsx scripts/collect-permit-zone-hours.ts --test-batch 5
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { chromium, Browser } from 'playwright';

// ─── ESM Polyfills ────────────────────────────────────────────
const __filename2 = fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);

// ─── Load Environment Variables ───────────────────────────────
for (const envFile of ['.env.prod', '.env.local']) {
  try {
    const content = fs.readFileSync(path.resolve(__dirname2, '..', envFile), 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

// ─── Environment ──────────────────────────────────────────────

const SUPABASE_URL = 'https://dzhqolbhuqdcpngdayuq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GOOGLE_MAPS_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_STREET_VIEW_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Rate limits
const NOMINATIM_DELAY_MS = 1100;
const GEMINI_DELAY_MS = 100; // Paid tier — 2000 RPM limit

// ─── Types ────────────────────────────────────────────────────

interface ZoneSample {
  zone: string;
  zone_type: 'residential' | 'industrial';
  sampleAddress: string;
  latitude: number | null;
  longitude: number | null;
}

interface ExtractionResult {
  zone: string;
  zone_type: string;
  restriction_hours: string | null;
  restriction_days: string | null;
  restriction_schedule: string | null;
  raw_sign_text: string | null;
  confidence: 'ai_extracted' | 'confirmed' | 'manual';
  source: string;
  sample_address: string;
  street_view_url: string | null;
  image_urls: string[];
  error?: string;
}

interface VisionResult {
  sign_found: boolean;
  zone_number: string | null;
  raw_sign_text: string | null;
  enforcement_days: string | null;
  enforcement_start_time: string | null;
  enforcement_end_time: string | null;
  restriction_schedule: string | null;
  confidence: string;
  notes: string | null;
}

interface ZoneSegment {
  zone: string;
  street_direction: string;
  street_name: string;
  street_type: string;
  address_range_low: number;
  address_range_high: number;
}

// ─── CLI Argument Parsing ─────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const REPORT_ONLY = args.includes('--report-only');
const SINGLE_ZONE = args.includes('--zone') ? args[args.indexOf('--zone') + 1] : null;
const TEST_BATCH = args.includes('--test-batch') ? parseInt(args[args.indexOf('--test-batch') + 1]) : null;
const REVERSE_ORDER = args.includes('--reverse');
const START_ZONE = args.includes('--start-zone') ? args[args.indexOf('--start-zone') + 1] : null;
const RETRY_MODE = args.includes('--retry'); // v12: try 10 NEW addresses per zone that v11 didn't use

// ─── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function logError(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ERROR: ${msg}`);
}

// ─── Geocoding (Nominatim + Google fallback) ──────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // Try Nominatim (free) first
  try {
    const fullAddress = `${address}, Chicago, IL`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TicketlessChicago/1.0 (permit-zone-hours-collector)' },
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      }
    }
  } catch {}

  // Fallback: Google Geocoding API
  if (GOOGLE_MAPS_KEY) {
    try {
      const fullAddress = `${address}, Chicago, IL`;
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(fullAddress)}&key=${GOOGLE_MAPS_KEY}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === 'OK' && data.results?.length > 0) {
          const loc = data.results[0].geometry.location;
          return { lat: loc.lat, lng: loc.lng };
        }
      }
    } catch {}
  }

  return null;
}

// ─── Street View via Google Maps JS API (Playwright) ──────────

let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    if (browserInstance) {
      try { await browserInstance.close(); } catch {}
    }
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try { await browserInstance.close(); } catch {}
    browserInstance = null;
  }
}

function buildStreetViewDisplayUrl(lat: number, lng: number, heading: number): string {
  return `https://www.google.com/maps/@${lat},${lng},3a,75y,${heading}h,80t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192`;
}

/**
 * Build an HTML page that loads Google Maps JS API StreetViewPanorama
 */
function buildStreetViewHtml(lat: number, lng: number, initialHeading: number, zoom: number, width: number, height: number): string {
  return `<!DOCTYPE html>
<html><head>
<style>html,body,#pano{margin:0;padding:0;width:100%;height:100%;overflow:hidden;}</style>
</head><body>
<div id="pano"></div>
<script>
  window.svStatus = 'loading';
  window.panoObj = null;
  function initPano() {
    try {
      window.panoObj = new google.maps.StreetViewPanorama(document.getElementById('pano'), {
        position: { lat: ${lat}, lng: ${lng} },
        pov: { heading: ${initialHeading}, pitch: 10 },
        zoom: ${zoom},
        disableDefaultUI: true,
        showRoadLabels: false
      });
      window.panoObj.addListener('status_changed', function() {
        var s = window.panoObj.getStatus();
        if (s === 'OK' || s === google.maps.StreetViewStatus.OK) {
          window.svStatus = 'ok';
        } else {
          window.svStatus = 'error';
        }
      });
    } catch(e) { window.svStatus = 'error'; }
  }
</script>
<script src="https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&callback=initPano" async defer></script>
</body></html>`;
}

/**
 * Wait for Street View to load in the page, return status
 */
async function waitForStreetView(page: any, maxWaitMs: number = 12000): Promise<'ok' | 'error'> {
  const pollInterval = 500;
  const maxPolls = Math.ceil(maxWaitMs / pollInterval);
  for (let i = 0; i < maxPolls; i++) {
    const status = await page.evaluate(() => (window as any).svStatus || 'loading');
    if (status === 'ok') return 'ok';
    if (status === 'error') return 'error';
    await page.waitForTimeout(pollInterval);
  }
  return 'error';
}

/**
 * Single-pass capture: 6 directions at 1280x960 zoom=2
 * JPEG 75, 1200ms wait between heading changes for image loading
 */
async function captureStreetView(
  lat: number, lng: number,
): Promise<Array<{ direction: string; buffer: Buffer }>> {
  const results: Array<{ direction: string; buffer: Buffer }> = [];
  const headings = [
    { name: 'N', heading: 0 },
    { name: 'NE', heading: 60 },
    { name: 'SE', heading: 120 },
    { name: 'S', heading: 180 },
    { name: 'SW', heading: 240 },
    { name: 'NW', heading: 300 },
  ];

  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });

    const html = buildStreetViewHtml(lat, lng, 0, 2, 1280, 960);
    const tmpFile = `/tmp/sv_v11_${Date.now()}.html`;
    fs.writeFileSync(tmpFile, html);

    await page.goto(`file://${tmpFile}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
    const status = await waitForStreetView(page);

    if (status !== 'ok') {
      await page.close();
      try { fs.unlinkSync(tmpFile); } catch {}
      return results;
    }

    for (const dir of headings) {
      await page.evaluate((h: number) => {
        const pano = (window as any).panoObj;
        if (pano) pano.setPov({ heading: h, pitch: pano.getPov().pitch });
      }, dir.heading);
      await page.waitForTimeout(1200);

      const screenshot = await page.screenshot({ type: 'jpeg', quality: 75 });
      if (screenshot.length >= 15000) {
        results.push({ direction: dir.name, buffer: Buffer.from(screenshot) });
      }
    }

    await page.close();
    try { fs.unlinkSync(tmpFile); } catch {}
    return results;
  } catch (err) {
    log(`    Capture error: ${err}`);
    return results;
  }
}

// ─── Gemini Vision Analysis ──────────────────────────────────

const GEMINI_PROMPT = `You are analyzing Google Street View images of a Chicago residential block to find PERMIT PARKING signs and extract their enforcement hours.

WHAT TO LOOK FOR:
- Signs that say "PERMIT PARKING ONLY" or "RESIDENTIAL PERMIT PARKING"
- Signs that say "NO PARKING" with "EXCEPT WITH PERMIT" below
- The zone number (e.g., "ZONE 62", "ZONE 383")
- The enforcement hours and days
- These are typically small green/white or red/white rectangular signs mounted on metal poles along the curb

RESPOND WITH EXACTLY THIS JSON (no other text):
{"sign_found":true,"zone_number":"62","raw_sign_text":"exact text on sign","enforcement_days":"Mon-Fri","enforcement_start_time":"6am","enforcement_end_time":"6pm","restriction_schedule":"Mon-Fri 6am-6pm","confidence":"high","notes":""}

OR if no permit parking sign found:
{"sign_found":false,"notes":"description"}

RULES:
- restriction_schedule format: "Mon-Fri 6am-6pm" or "24/7"
- Use lowercase am/pm: "6am", "10pm"
- Day ranges: "Mon-Fri", "Mon-Sat", "Mon-Sun", "All Days"
- "ALL TIMES" → "24/7"
- confidence: "high" if clearly readable, "medium" if partial, "low" if guessing`;

/**
 * Analyze images using Gemini 2.0 Flash vision model.
 * Free tier: 1500 RPD, 4M TPM.
 */
async function analyzeImagesWithGemini(
  images: Array<{ direction: string; base64: string }>,
  expectedZone?: string,
): Promise<VisionResult> {
  const defaultResult: VisionResult = {
    sign_found: false, zone_number: null, raw_sign_text: null,
    enforcement_days: null, enforcement_start_time: null, enforcement_end_time: null,
    restriction_schedule: null, confidence: 'low', notes: null,
  };

  // Build Gemini request with inline images
  const parts: any[] = [{ text: GEMINI_PROMPT }];
  for (const img of images) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: img.base64,
      },
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (resp.status === 429) {
      log(`    Gemini rate limited, waiting 60s...`);
      await sleep(60000);
      return analyzeImagesWithGemini(images, expectedZone);
    }

    if (!resp.ok) {
      const errText = await resp.text();
      logError(`Gemini API error: ${resp.status} ${errText.substring(0, 300)}`);
      return { ...defaultResult, notes: `API error: ${resp.status}` };
    }

    const data = await resp.json() as any;
    const responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Parse JSON from response
    let parsed: any = null;
    try {
      const fenceMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        parsed = JSON.parse(fenceMatch[1].trim());
      } else {
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        }
      }
    } catch {}

    if (!parsed) {
      log(`    Gemini response unparseable: ${responseText.substring(0, 200)}`);
      return { ...defaultResult, notes: 'Parse error' };
    }

    return { ...defaultResult, ...parsed };
  } catch (err: any) {
    logError(`Gemini fetch error: ${err?.message || err}`);
    return { ...defaultResult, notes: `Fetch error: ${err?.message || err}` };
  }
}

/**
 * Check if the detected sign is a false positive (not actually permit parking)
 */
function isFalsePositive(analysis: VisionResult): boolean {
  const text = (analysis.raw_sign_text || '').toLowerCase();
  const notes = (analysis.notes || '').toLowerCase();
  const combined = text + ' ' + notes;

  // Check for non-permit-parking signs
  const falsePositivePatterns = [
    'tow zone', 'tow away', 'loading zone', 'handicapped', 'disabled',
    'construction', 'temporary', 'fire lane', 'bus stop', 'taxi stand',
    'reserved for', 'visitor parking', 'employee parking', 'customer parking',
    'no standing', 'no stopping', 'street cleaning',
  ];

  for (const pattern of falsePositivePatterns) {
    if (combined.includes(pattern)) {
      return true;
    }
  }

  return false;
}

// ─── Zone Sampling ────────────────────────────────────────────

let totalApiCalls = 0;  // Module-level counter for cost estimation
const zoneSegmentsMap = new Map<string, ZoneSegment[]>();

function buildAddressFromSegment(seg: ZoneSegment, position: 'low' | 'mid' | 'high' = 'mid'): string {
  let num: number;
  if (position === 'low') {
    num = seg.address_range_low + 1;
  } else if (position === 'high') {
    num = seg.address_range_high - 1;
  } else {
    // Mid-block: signs are typically mid-block, not at intersections
    num = Math.round((seg.address_range_low + seg.address_range_high) / 2);
    // Make it odd (most residential addresses are odd on one side)
    if (num % 2 === 0) num += 1;
  }
  const dir = seg.street_direction || '';
  const name = seg.street_name || '';
  const type = seg.street_type || '';
  return `${num} ${dir} ${name} ${type}`.replace(/\s+/g, ' ').trim();
}

/**
 * v12 retry: build address at a fractional position within the segment range.
 * Uses EVEN numbers (v11 uses odd) and avoids the exact low+1, mid, high-1 positions v11 used.
 * @param fraction 0.0 = low end, 1.0 = high end
 */
function buildAddressFromSegmentFractional(seg: ZoneSegment, fraction: number): string {
  const range = seg.address_range_high - seg.address_range_low;
  let num = Math.round(seg.address_range_low + range * fraction);
  // Make it EVEN (v11 always makes mid odd, so even numbers are guaranteed different)
  if (num % 2 !== 0) num += 1;
  // Clamp within range
  num = Math.max(seg.address_range_low + 2, Math.min(seg.address_range_high - 2, num));
  const dir = seg.street_direction || '';
  const name = seg.street_name || '';
  const type = seg.street_type || '';
  return `${num} ${dir} ${name} ${type}`.replace(/\s+/g, ' ').trim();
}

function getStreetName(seg: ZoneSegment): string {
  return `${seg.street_direction || ''} ${seg.street_name || ''} ${seg.street_type || ''}`.replace(/\s+/g, ' ').trim();
}

async function getUniqueZones(supabase: SupabaseClient): Promise<ZoneSample[]> {
  log('Fetching unique permit zones from parking_permit_zones...');

  const allZones: ZoneSegment[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('parking_permit_zones')
      .select('zone, street_direction, street_name, street_type, address_range_low, address_range_high')
      .eq('status', 'ACTIVE')
      .order('zone')
      .range(offset, offset + pageSize - 1);

    if (error) {
      logError(`Failed to fetch zones at offset ${offset}: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;
    allZones.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  if (allZones.length === 0) {
    logError('No active zones found');
    return [];
  }

  log(`Fetched ${allZones.length} zone segments`);

  for (const row of allZones) {
    if (!zoneSegmentsMap.has(row.zone)) zoneSegmentsMap.set(row.zone, []);
    zoneSegmentsMap.get(row.zone)!.push(row);
  }

  const samples: ZoneSample[] = [];
  for (const [zone, segments] of zoneSegmentsMap) {
    // Pick the segment with the widest address range (more mid-block options)
    const bestSeg = segments.reduce((best, seg) =>
      (seg.address_range_high - seg.address_range_low) > (best.address_range_high - best.address_range_low) ? seg : best
    );
    const sampleAddress = buildAddressFromSegment(bestSeg, 'mid');
    samples.push({
      zone,
      zone_type: 'residential',
      sampleAddress,
      latitude: null,
      longitude: null,
    });
  }

  log(`Found ${samples.length} unique zones`);
  return samples;
}

// ─── Main Pipeline ────────────────────────────────────────────

async function processZone(
  sample: ZoneSample,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    zone: sample.zone,
    zone_type: sample.zone_type,
    restriction_hours: null,
    restriction_days: null,
    restriction_schedule: null,
    raw_sign_text: null,
    confidence: 'ai_extracted',
    source: 'gemini_street_view',
    sample_address: sample.sampleAddress,
    street_view_url: null,
    image_urls: [],
  };

  // Smart address selection — mid-block addresses on diverse streets
  const segments = zoneSegmentsMap.get(sample.zone) || [];
  const addressesToTry: string[] = [];
  const seenAddresses = new Set<string>();

  if (RETRY_MODE) {
    // ── v12 RETRY: 10 NEW addresses that v11 didn't try ──
    // v11 used: positions ['mid','mid','low','high','mid'] with ODD numbers, random segment order
    // v12 uses: fractional positions [0.25, 0.33, 0.67, 0.75, 0.10, 0.90, 0.40, 0.60, 0.15, 0.85] with EVEN numbers
    //           sorted segments (deterministic, reverse alphabetical = different order than v11's random)
    const retryFractions = [0.25, 0.33, 0.67, 0.75, 0.10, 0.90, 0.40, 0.60, 0.15, 0.85];
    // Sort segments by street name (reverse alpha) — deterministic and different from v11's random shuffle
    const sorted = [...segments].sort((a, b) => {
      const nameA = getStreetName(a);
      const nameB = getStreetName(b);
      return nameB.localeCompare(nameA);
    });

    // Also compute what v11 WOULD have tried so we can skip those addresses
    const v11Addresses = new Set<string>();
    for (const seg of segments) {
      v11Addresses.add(buildAddressFromSegment(seg, 'mid'));
      v11Addresses.add(buildAddressFromSegment(seg, 'low'));
      v11Addresses.add(buildAddressFromSegment(seg, 'high'));
    }
    // Also add the sample address (widest block mid) which v11 always includes
    v11Addresses.add(sample.sampleAddress);

    let fracIdx = 0;
    for (const seg of sorted) {
      if (addressesToTry.length >= 10) break;
      if (fracIdx >= retryFractions.length) break;
      const frac = retryFractions[fracIdx];
      const addr = buildAddressFromSegmentFractional(seg, frac);
      if (seenAddresses.has(addr) || v11Addresses.has(addr)) {
        // Try next fraction on same segment
        fracIdx++;
        continue;
      }
      seenAddresses.add(addr);
      addressesToTry.push(addr);
      fracIdx++;
    }

    // If we still need more, cycle through remaining segments with remaining fractions
    if (addressesToTry.length < 10) {
      for (const seg of sorted) {
        if (addressesToTry.length >= 10) break;
        for (const frac of retryFractions) {
          if (addressesToTry.length >= 10) break;
          const addr = buildAddressFromSegmentFractional(seg, frac);
          if (seenAddresses.has(addr) || v11Addresses.has(addr)) continue;
          seenAddresses.add(addr);
          addressesToTry.push(addr);
        }
      }
    }
  } else {
    // ── v11 ORIGINAL: 5 addresses with mid/low/high positions ──
    // Shuffle segments to avoid always trying the same streets first
    const shuffled = [...segments].sort(() => Math.random() - 0.5);

    // Strategy: try mid-block first (highest chance of sign), then vary positions
    const positions: Array<'mid' | 'low' | 'high'> = ['mid', 'mid', 'low', 'high', 'mid'];
    const seenStreets = new Set<string>();
    let posIdx = 0;

    for (const seg of shuffled) {
      if (addressesToTry.length >= 5) break;
      const street = getStreetName(seg);
      const pos = positions[posIdx] || 'mid';
      const addr = buildAddressFromSegment(seg, pos);
      if (seenAddresses.has(addr)) continue;
      // For mid position, prefer wider blocks (more likely to have sign visible)
      if (pos === 'mid' && (seg.address_range_high - seg.address_range_low) < 50) {
        if (addressesToTry.length >= 3 && !seenStreets.has(street)) {
          // Still add it if we haven't tried this street
        } else if (seenStreets.has(street)) {
          continue;
        }
      }
      seenAddresses.add(addr);
      seenStreets.add(street);
      addressesToTry.push(addr);
      posIdx++;
    }

    // Ensure the original sample address is in the list
    if (!seenAddresses.has(sample.sampleAddress) && addressesToTry.length < 5) {
      addressesToTry.push(sample.sampleAddress);
    }
  }

  for (const addr of addressesToTry) {
    // Step 1: Geocode
    log(`  Zone ${sample.zone}: Geocoding "${addr}"...`);
    const geo = await geocodeAddress(addr);
    await sleep(NOMINATIM_DELAY_MS);

    if (!geo) {
      log(`  Zone ${sample.zone}: Geocoding failed for "${addr}", trying next...`);
      continue;
    }

    // Step 2: Capture 6 directions at 1280x960 zoom=2
    log(`  Zone ${sample.zone}: Capturing at ${addr}...`);
    const captures = await captureStreetView(geo.lat, geo.lng);

    if (captures.length === 0) {
      log(`  Zone ${sample.zone}: No Street View at "${addr}", trying next...`);
      continue;
    }

    const images = captures.map(c => ({ direction: c.direction, base64: c.buffer.toString('base64') }));
    log(`  Zone ${sample.zone}: ${images.length} images → Gemini Flash...`);

    result.image_urls = [buildStreetViewDisplayUrl(geo.lat, geo.lng, 0)];
    result.street_view_url = buildStreetViewDisplayUrl(geo.lat, geo.lng, 0);

    // Step 3: Gemini vision analysis
    totalApiCalls++;
    const analysis = await analyzeImagesWithGemini(images, sample.zone);
    await sleep(GEMINI_DELAY_MS);

    if (!analysis.sign_found) {
      log(`  Zone ${sample.zone}: No sign at "${addr}" (${analysis.notes || 'no details'})`);
      result.sample_address = addr;
      result.error = `No sign at ${addr}`;
      continue;
    }

    // Check for false positives
    if (isFalsePositive(analysis)) {
      log(`  Zone ${sample.zone}: False positive at "${addr}": ${analysis.raw_sign_text}`);
      result.sample_address = addr;
      result.error = `False positive at ${addr}`;
      continue;
    }

    // Populate result
    result.sample_address = addr;
    result.raw_sign_text = analysis.raw_sign_text;
    result.restriction_schedule = analysis.restriction_schedule;

    // Parse restriction_schedule into hours and days
    if (analysis.restriction_schedule) {
      if (analysis.restriction_schedule === '24/7') {
        result.restriction_hours = '24/7';
        result.restriction_days = 'All Days';
      } else {
        const hoursMatch = analysis.restriction_schedule.match(/(\d{1,2}(?:am|pm)\s*-\s*\d{1,2}(?:am|pm))/i);
        result.restriction_hours = hoursMatch ? hoursMatch[1].replace(/\s/g, '') : null;
        result.restriction_days = analysis.enforcement_days || null;
      }
    }

    // Zone number mismatch warning
    if (analysis.zone_number && analysis.zone_number !== sample.zone) {
      log(`  Zone ${sample.zone}: WARNING — sign shows Zone ${analysis.zone_number} (expected ${sample.zone})`);
    }

    // Validate schedule is a real time range, not junk
    const sched = result.restriction_schedule || '';
    const isValidSchedule = sched === '24/7' || /\d{1,2}(?:am|pm)/i.test(sched);

    if (result.restriction_schedule && isValidSchedule) {
      log(`  Zone ${sample.zone}: Found: "${result.restriction_schedule}" (${analysis.confidence})`);
      return result;
    } else if (result.restriction_schedule && !isValidSchedule) {
      log(`  Zone ${sample.zone}: Invalid schedule "${result.restriction_schedule}", skipping`);
      result.restriction_schedule = null;
      result.error = `Invalid schedule at ${addr}`;
      continue;
    } else if (analysis.sign_found) {
      log(`  Zone ${sample.zone}: Sign found but no schedule extractable. Raw: "${analysis.raw_sign_text}"`);
      result.error = 'Sign found but schedule not extractable';
      continue;
    }
  }

  // Tried all addresses without success
  if (!result.error) {
    result.error = `No sign found after ${addressesToTry.length} addresses`;
  }
  log(`  Zone ${sample.zone}: ${result.error}`);
  return result;
}

async function upsertResult(supabase: SupabaseClient, result: ExtractionResult): Promise<void> {
  if (!result.restriction_schedule) return;

  const row: Record<string, any> = {
    zone: result.zone,
    zone_type: result.zone_type,
    restriction_hours: result.restriction_hours,
    restriction_days: result.restriction_days,
    restriction_schedule: result.restriction_schedule,
    confidence: 'ai_extracted',
    source: result.source,
    reported_address: result.sample_address,
    notes: result.raw_sign_text ? `AI-extracted sign text: ${result.raw_sign_text}` : null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('permit_zone_hours')
    .upsert(row, { onConflict: 'zone,zone_type' });

  if (error) {
    logError(`  DB upsert failed for Zone ${result.zone}: ${error.message}`);
  }
}

// ─── Report Generator ─────────────────────────────────────────

async function generateReport(supabase: SupabaseClient): Promise<void> {
  const { data: rows, error } = await supabase
    .from('permit_zone_hours')
    .select('*')
    .order('zone');

  if (error || !rows) {
    logError(`Failed to fetch results: ${error?.message}`);
    return;
  }

  log(`\n${'='.repeat(70)}`);
  log(`PERMIT ZONE HOURS — EXTRACTION REPORT`);
  log(`${'='.repeat(70)}`);
  log(`Total zones with data: ${rows.length}`);
  log(`  AI Extracted: ${rows.filter(r => r.confidence === 'ai_extracted').length}`);

  const scheduleGroups = new Map<string, string[]>();
  for (const row of rows) {
    const sched = row.restriction_schedule || 'UNKNOWN';
    if (!scheduleGroups.has(sched)) scheduleGroups.set(sched, []);
    scheduleGroups.get(sched)!.push(row.zone);
  }

  log('\nSchedule Distribution:');
  const sorted = [...scheduleGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [schedule, zones] of sorted) {
    log(`  "${schedule}" — ${zones.length} zone(s): ${zones.slice(0, 10).join(', ')}${zones.length > 10 ? '...' : ''}`);
  }

  log('\nDone with report.');
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!GOOGLE_MAPS_KEY) missing.push('GOOGLE_API_KEY');
  if (!GEMINI_API_KEY) missing.push('GEMINI_API_KEY');

  if (missing.length > 0) {
    logError(`Missing environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Quick Gemini API test
  log('Testing Gemini API access...');
  try {
    const testResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Say OK' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!testResp.ok) {
      const errText = await testResp.text();
      logError(`Gemini API test failed: ${testResp.status} ${errText.substring(0, 200)}`);
      process.exit(1);
    }
    log('Gemini API access confirmed (free tier).');
  } catch (err: any) {
    logError(`Gemini API test failed: ${err?.message || err}`);
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  log(`=== Permit Zone Hours Collection Pipeline (${RETRY_MODE ? 'v12 RETRY' : 'v11'} — Gemini Flash Vision) ===`);
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Skip existing: ${SKIP_EXISTING || RETRY_MODE} | Retry: ${RETRY_MODE}`);
  if (RETRY_MODE) log('v12 RETRY: Trying 10 NEW addresses per zone (even numbers, fractional positions)');

  if (REPORT_ONLY) {
    await generateReport(supabase);
    return;
  }

  let samples = await getUniqueZones(supabase);

  if (SINGLE_ZONE) {
    samples = samples.filter(s => s.zone === SINGLE_ZONE);
    if (samples.length === 0) {
      logError(`Zone "${SINGLE_ZONE}" not found`);
      process.exit(1);
    }
    log(`Filtering to single zone: ${SINGLE_ZONE}`);
  }

  if (SKIP_EXISTING || RETRY_MODE) {
    const { data: existing } = await supabase
      .from('permit_zone_hours')
      .select('zone, zone_type');

    if (existing) {
      const existingKeys = new Set(existing.map(e => `${e.zone_type}:${e.zone}`));
      const before = samples.length;
      samples = samples.filter(s => !existingKeys.has(`${s.zone_type}:${s.zone}`));
      log(`Skipping ${before - samples.length} zones already in DB, ${samples.length} remaining`);
    }
  }

  // Reverse order support — process zones from end of list
  if (REVERSE_ORDER) {
    samples.reverse();
    log(`REVERSE ORDER: Processing zones from ${samples[0]?.zone} downward`);
  }

  // Start from a specific zone (skip zones before it in the sorted list)
  if (START_ZONE) {
    const idx = samples.findIndex(s => s.zone >= START_ZONE);
    if (idx > 0) {
      samples = samples.slice(idx);
      log(`START ZONE: Skipping to zone ${START_ZONE}, ${samples.length} zones remaining`);
    }
  }

  // test-batch support — run only N zones to measure success rate
  if (TEST_BATCH && TEST_BATCH > 0) {
    // Shuffle to get a representative sample
    samples.sort(() => Math.random() - 0.5);
    samples = samples.slice(0, TEST_BATCH);
    log(`TEST BATCH: Running ${TEST_BATCH} randomly-selected zones`);
  }

  log(`Processing ${samples.length} zones...\n`);

  const results: ExtractionResult[] = [];
  let successCount = 0;
  let errorCount = 0;
  totalApiCalls = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    log(`[${i + 1}/${samples.length}] Zone ${sample.zone} — ${sample.sampleAddress}`);

    try {
      const result = await processZone(sample);
      results.push(result);

      if (result.restriction_schedule) {
        successCount++;
        if (!DRY_RUN) {
          await upsertResult(supabase, result);
        }
      } else {
        errorCount++;
      }
    } catch (err) {
      logError(`Zone ${sample.zone} failed: ${err}`);
      results.push({
        zone: sample.zone,
        zone_type: sample.zone_type,
        restriction_hours: null,
        restriction_days: null,
        restriction_schedule: null,
        raw_sign_text: null,
        confidence: 'ai_extracted',
        source: 'gemini_street_view',
        sample_address: sample.sampleAddress,
        street_view_url: null,
        image_urls: [],
        error: String(err),
      });
      errorCount++;
    }

    // Progress update every 10 zones
    if ((i + 1) % 10 === 0) {
      log(`  Progress: ${i + 1}/${samples.length} (${successCount} extracted, ${errorCount} errors)`);
    }
  }

  // Summary
  log('\n' + '='.repeat(70));
  log('COLLECTION COMPLETE');
  log('='.repeat(70));
  log(`Total zones processed: ${results.length}`);
  log(`  Schedules extracted: ${successCount}`);
  log(`  Errors/no sign:      ${errorCount}`);
  log(`  Success rate:        ${results.length > 0 ? ((successCount / results.length) * 100).toFixed(1) : 0}%`);
  log(`  Gemini API calls:    ${totalApiCalls}`);
  log(`  Cost:                $0.00 (Gemini Flash free tier)`);
  if (results.length > 0) {
    const callsPerZone = totalApiCalls / results.length;
    log(`  Avg calls/zone:      ${callsPerZone.toFixed(1)}`);
    if (TEST_BATCH) {
      const remainingZones = 1536 - results.length;
      const projectedExtractions = Math.round(remainingZones * (successCount / results.length));
      log(`\n  === PROJECTED FULL RUN (${remainingZones} remaining zones) ===`);
      log(`  Projected extractions: ~${projectedExtractions}`);
      log(`  Projected total zones with data: ~${394 + projectedExtractions} / 1930`);
      log(`  Cost: $0.00 (Gemini Flash free tier)`);
    }
  }

  const extracted = results.filter(r => r.restriction_schedule);
  if (extracted.length > 0) {
    log('\nExtracted Schedules:');
    for (const r of extracted) {
      log(`  Zone ${r.zone}: "${r.restriction_schedule}" (raw: "${r.raw_sign_text}")`);
    }
  }

  const failed = results.filter(r => r.error);
  if (failed.length > 0) {
    log(`\nFailed Zones (${failed.length}):`);
    for (const r of failed) {
      log(`  Zone ${r.zone}: ${r.error}`);
    }
  }

  if (!DRY_RUN) {
    await generateReport(supabase);
  }

  await closeBrowser();
  log('\nDone.');
}

main().catch(async err => {
  logError(`Fatal: ${err}`);
  await closeBrowser();
  process.exit(1);
});
