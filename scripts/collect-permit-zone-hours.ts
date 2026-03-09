#!/usr/bin/env npx ts-node
/**
 * Collect Permit Zone Hours via Street View + Claude Vision
 *
 * For each unique permit zone in Chicago, this script:
 *   1. Samples one address from the zone's segments
 *   2. Fetches 4 Google Street View images (N/E/S/W)
 *   3. Sends images to Claude Vision to read the permit sign
 *   4. Extracts the enforcement schedule (e.g., "Mon-Fri 6am-6pm")
 *   5. Upserts results into the `permit_zone_hours` table
 *
 * Cost estimate:
 *   - ~280 residential zones × 4 images × $0.007/image = ~$8 Street View
 *   - ~280 zones × ~$0.02/analysis = ~$6 Claude Vision
 *   - Total: ~$14 one-time
 *
 * Usage:
 *   npx ts-node scripts/collect-permit-zone-hours.ts
 *   npx ts-node scripts/collect-permit-zone-hours.ts --zone 62          # Single zone
 *   npx ts-node scripts/collect-permit-zone-hours.ts --dry-run          # No DB writes
 *   npx ts-node scripts/collect-permit-zone-hours.ts --skip-existing    # Skip zones already in DB
 *   npx ts-node scripts/collect-permit-zone-hours.ts --report-only      # Generate HTML report from DB
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';

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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Rate limit: 1 req/sec for Nominatim, generous for Google & Claude
const NOMINATIM_DELAY_MS = 1100;
const GOOGLE_DELAY_MS = 200;
const CLAUDE_DELAY_MS = 500;

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
  restriction_hours: string | null;   // e.g., "6am-6pm"
  restriction_days: string | null;    // e.g., "Mon-Fri"
  restriction_schedule: string | null; // e.g., "Mon-Fri 6am-6pm"
  raw_sign_text: string | null;
  confidence: 'ai_extracted' | 'confirmed' | 'manual';
  source: string;
  sample_address: string;
  street_view_url: string | null;
  image_urls: string[];
  error?: string;
}

// ─── CLI Argument Parsing ─────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const REPORT_ONLY = args.includes('--report-only');
const SINGLE_ZONE = args.includes('--zone') ? args[args.indexOf('--zone') + 1] : null;

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

// ─── Nominatim Geocoding ──────────────────────────────────────

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const fullAddress = `${address}, Chicago, IL`;
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(fullAddress)}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'TicketlessChicago/1.0 (permit-zone-hours-collector)' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data || data.length === 0) return null;
    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  } catch {
    return null;
  }
}

// ─── Street View (via Playwright screenshots) ───────────────

// Shared browser instance (reused across all zones)
let browserInstance: Awaited<ReturnType<typeof chromium.launch>> | null = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

function buildStreetViewUrl(lat: number, lng: number, heading: number, pitch: number = 15, fov: number = 80): string {
  // Google Maps Street View URL — opens in browser with specified view
  return `https://www.google.com/maps/@${lat},${lng},3a,${fov}y,${heading}h,${90 - pitch}t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192`;
}

function buildStreetViewDisplayUrl(lat: number, lng: number, heading: number): string {
  return buildStreetViewUrl(lat, lng, heading);
}

/**
 * Capture a Street View screenshot via Playwright.
 * Opens Google Street View in headless Chrome, waits for imagery to load,
 * and takes a screenshot. Returns the image as a Buffer, or null on failure.
 */
async function captureStreetViewScreenshot(
  lat: number,
  lng: number,
  heading: number,
  pitch: number = 15,
): Promise<Buffer | null> {
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    // Navigate to Google Street View
    const url = buildStreetViewUrl(lat, lng, heading, pitch);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // Wait for the Street View canvas to render
    // Google Maps uses canvas elements for Street View rendering
    await page.waitForTimeout(4000);

    // Dismiss any consent dialogs or popups
    try {
      const consentBtn = page.locator('button:has-text("Accept all")');
      if (await consentBtn.isVisible({ timeout: 1000 })) {
        await consentBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {}

    // Try to dismiss the "You're using an unsupported browser" notice
    try {
      const dismissBtn = page.locator('[aria-label="Close"]').first();
      if (await dismissBtn.isVisible({ timeout: 500 })) {
        await dismissBtn.click();
        await page.waitForTimeout(500);
      }
    } catch {}

    // Wait a bit more for imagery to load
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ type: 'jpeg', quality: 85 });
    await context.close();

    // Reject if screenshot is too small (likely an error page)
    if (screenshot.length < 10000) {
      return null;
    }

    return Buffer.from(screenshot);
  } catch (err) {
    log(`    Screenshot error: ${err}`);
    return null;
  }
}

/**
 * Check if Street View is available by trying to load the page.
 * Returns true if the page loads with imagery (not a "no imagery" page).
 */
async function checkStreetViewAvailability(
  lat: number,
  lng: number,
): Promise<{ available: boolean; panoId: string | null }> {
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    const url = buildStreetViewUrl(lat, lng, 0);
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(3000);

    // Check if Street View loaded (look for canvas or the "Sorry, we have no imagery" message)
    const noImagery = await page.locator('text=Sorry, we have no imagery').isVisible({ timeout: 1000 }).catch(() => false);
    const hasCanvas = await page.locator('canvas').first().isVisible({ timeout: 1000 }).catch(() => false);

    await context.close();

    return {
      available: !noImagery && hasCanvas,
      panoId: null,
    };
  } catch {
    return { available: false, panoId: null };
  }
}

// ─── Claude Vision Analysis ───────────────────────────────────

const PERMIT_SIGN_PROMPT = `You are analyzing Google Street View images of a Chicago residential block to find PERMIT PARKING signs and extract their enforcement hours.

WHAT TO LOOK FOR:
- Signs that say "PERMIT PARKING ONLY" or "RESIDENTIAL PERMIT PARKING"
- The zone number (e.g., "ZONE 62", "ZONE 383")
- The enforcement hours and days (e.g., "6 AM TO 6 PM", "MON THRU FRI", "ALL TIMES")
- Any additional restrictions or exceptions

COMMON CHICAGO PERMIT SIGN FORMATS:
- "PERMIT PARKING ONLY / ZONE [NUMBER] / [DAYS] / [HOURS]"
- "NO PARKING / [TIME RANGE] / EXCEPT WITH PERMIT / ZONE [NUMBER]"
- Hours are typically: "6 AM TO 6 PM", "8 AM TO 10 PM", "ALL TIMES", "6 PM TO 6 AM"
- Days are typically: "MON THRU FRI", "MON THRU SAT", "ALL DAYS", "7 DAYS A WEEK"

RESPOND WITH EXACTLY THIS JSON FORMAT:
{
  "sign_found": true/false,
  "zone_number": "62" or null,
  "raw_sign_text": "exact text on the sign as you read it" or null,
  "enforcement_days": "Mon-Fri" or "Mon-Sat" or "Mon-Sun" or "24/7" or null,
  "enforcement_start_time": "6am" or "8am" or null,
  "enforcement_end_time": "6pm" or "10pm" or null,
  "restriction_schedule": "Mon-Fri 6am-6pm" or "24/7" or null,
  "confidence": "high" or "medium" or "low",
  "notes": "any additional observations about the sign"
}

IMPORTANT:
- If you see a permit parking sign in ANY of the images, report it
- The restriction_schedule field should be in the format the app expects: "Mon-Fri 6am-6pm"
- Use lowercase am/pm, no spaces: "6am", "10pm"
- Use abbreviated day ranges: "Mon-Fri", "Mon-Sat", "Mon-Sun"
- If the sign says "ALL TIMES" or similar, use "24/7"
- If you can see a zone number but not the hours, still report what you can see
- If multiple signs show different zones, report the most visible/readable one
- "confidence" should be "high" if text is clearly readable, "medium" if partially visible, "low" if guessing

Analyze these Street View images:`;

async function analyzeImagesForPermitSign(
  images: Array<{ direction: string; base64: string }>,
  anthropic: Anthropic,
): Promise<{
  sign_found: boolean;
  zone_number: string | null;
  raw_sign_text: string | null;
  enforcement_days: string | null;
  enforcement_start_time: string | null;
  enforcement_end_time: string | null;
  restriction_schedule: string | null;
  confidence: string;
  notes: string | null;
}> {
  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  content.push({ type: 'text' as const, text: PERMIT_SIGN_PROMPT });

  for (const img of images) {
    content.push({
      type: 'text' as const,
      text: `\n--- ${img.direction} facing view ---`,
    });
    content.push({
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/jpeg' as const,
        data: img.base64,
      },
    });
  }

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{ role: 'user', content }],
  });

  const responseText = message.content[0].type === 'text' ? message.content[0].text : '';

  try {
    // Extract JSON from response (handle markdown fences)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logError('Could not parse Claude Vision response');
      return { sign_found: false, zone_number: null, raw_sign_text: null, enforcement_days: null, enforcement_start_time: null, enforcement_end_time: null, restriction_schedule: null, confidence: 'low', notes: 'Parse error' };
    }
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    logError(`JSON parse error: ${e}`);
    return { sign_found: false, zone_number: null, raw_sign_text: null, enforcement_days: null, enforcement_start_time: null, enforcement_end_time: null, restriction_schedule: null, confidence: 'low', notes: 'JSON parse error' };
  }
}

// ─── Zone Sampling ────────────────────────────────────────────

interface ZoneSegment {
  zone: string;
  street_direction: string;
  street_name: string;
  street_type: string;
  address_range_low: number;
  address_range_high: number;
}

// Store all segments per zone so we can try alternates if first address fails
const zoneSegmentsMap = new Map<string, ZoneSegment[]>();

function buildAddressFromSegment(seg: ZoneSegment): string {
  const midNumber = Math.round((seg.address_range_low + seg.address_range_high) / 2);
  const sampleNumber = midNumber % 2 === seg.address_range_low % 2 ? midNumber : midNumber + 1;
  const dir = seg.street_direction || '';
  const name = seg.street_name || '';
  const type = seg.street_type || '';
  return `${sampleNumber} ${dir} ${name} ${type}`.replace(/\s+/g, ' ').trim();
}

async function getUniqueZones(supabase: SupabaseClient): Promise<ZoneSample[]> {
  log('Fetching unique permit zones from parking_permit_zones...');

  // Paginate to get ALL active zone segments (table has ~10k rows)
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

  // Group ALL segments by zone (for fallback addresses)
  for (const row of allZones) {
    if (!zoneSegmentsMap.has(row.zone)) zoneSegmentsMap.set(row.zone, []);
    zoneSegmentsMap.get(row.zone)!.push(row);
  }

  // Pick one sample address per zone (first segment)
  const samples: ZoneSample[] = [];

  for (const [zone, segments] of zoneSegmentsMap) {
    const seg = segments[0];
    const sampleAddress = buildAddressFromSegment(seg);

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
  anthropic: Anthropic,
): Promise<ExtractionResult> {
  const result: ExtractionResult = {
    zone: sample.zone,
    zone_type: sample.zone_type,
    restriction_hours: null,
    restriction_days: null,
    restriction_schedule: null,
    raw_sign_text: null,
    confidence: 'ai_extracted',
    source: 'street_view_vision',
    sample_address: sample.sampleAddress,
    street_view_url: null,
    image_urls: [],
  };

  // Try the primary address, then up to 3 alternates from other segments
  const segments = zoneSegmentsMap.get(sample.zone) || [];
  const addressesToTry = [sample.sampleAddress];

  // Add up to 3 alternate addresses from different street segments
  for (const seg of segments.slice(1, 4)) {
    const addr = buildAddressFromSegment(seg);
    if (!addressesToTry.includes(addr)) {
      addressesToTry.push(addr);
    }
  }

  let coords: { lat: number; lng: number } | null = null;
  let usedAddress = sample.sampleAddress;

  for (const addr of addressesToTry) {
    // Step 1: Geocode the sample address
    log(`  Zone ${sample.zone}: Geocoding "${addr}"...`);
    const geo = await geocodeAddress(addr);
    await sleep(NOMINATIM_DELAY_MS);

    if (!geo) {
      log(`  Zone ${sample.zone}: Geocoding failed for "${addr}", trying next...`);
      continue;
    }

    coords = geo;
    usedAddress = addr;
    break;
  }

  if (!coords) {
    result.error = `Geocoding failed (tried ${addressesToTry.length} addresses)`;
    log(`  Zone ${sample.zone}: Geocoding failed after ${addressesToTry.length} tries`);
    return result;
  }

  result.sample_address = usedAddress;
  sample.latitude = coords.lat;
  sample.longitude = coords.lng;

  // Step 2: Capture Street View screenshots at 4 headings via Playwright
  const directions = [
    { name: 'North', heading: 0 },
    { name: 'East', heading: 90 },
    { name: 'South', heading: 180 },
    { name: 'West', heading: 270 },
  ];

  const images: Array<{ direction: string; base64: string }> = [];

  log(`  Zone ${sample.zone}: Capturing Street View screenshots...`);

  for (const dir of directions) {
    result.image_urls.push(buildStreetViewDisplayUrl(coords.lat, coords.lng, dir.heading));

    const imgBuf = await captureStreetViewScreenshot(coords.lat, coords.lng, dir.heading);

    if (imgBuf) {
      images.push({
        direction: dir.name,
        base64: imgBuf.toString('base64'),
      });
    }
  }

  result.street_view_url = buildStreetViewDisplayUrl(coords.lat, coords.lng, 0);

  if (images.length === 0) {
    result.error = 'All images were placeholders or failed to download';
    log(`  Zone ${sample.zone}: No valid images downloaded`);
    return result;
  }

  log(`  Zone ${sample.zone}: Downloaded ${images.length}/4 images, sending to Claude Vision...`);

  // Step 4: Analyze with Claude Vision
  const analysis = await analyzeImagesForPermitSign(images, anthropic);
  await sleep(CLAUDE_DELAY_MS);

  if (!analysis.sign_found) {
    result.error = 'No permit sign found in images';
    result.raw_sign_text = analysis.notes || null;
    log(`  Zone ${sample.zone}: No permit sign found. Notes: ${analysis.notes}`);
    return result;
  }

  result.raw_sign_text = analysis.raw_sign_text;
  result.restriction_schedule = analysis.restriction_schedule;

  // Parse restriction_schedule into hours and days components
  if (analysis.restriction_schedule) {
    if (analysis.restriction_schedule === '24/7') {
      result.restriction_hours = '24/7';
      result.restriction_days = 'All Days';
    } else {
      // Extract hours: e.g., "Mon-Fri 6am-6pm" → "6am-6pm"
      const hoursMatch = analysis.restriction_schedule.match(/(\d{1,2}(?:am|pm)\s*-\s*\d{1,2}(?:am|pm))/i);
      result.restriction_hours = hoursMatch ? hoursMatch[1].replace(/\s/g, '') : analysis.enforcement_start_time && analysis.enforcement_end_time ? `${analysis.enforcement_start_time}-${analysis.enforcement_end_time}` : null;
      // Extract days: e.g., "Mon-Fri 6am-6pm" → "Mon-Fri"
      result.restriction_days = analysis.enforcement_days || null;
    }
  }

  // Validate zone number matches (optional — signs may show different zone)
  if (analysis.zone_number && analysis.zone_number !== sample.zone) {
    log(`  Zone ${sample.zone}: WARNING — sign shows Zone ${analysis.zone_number} (expected ${sample.zone})`);
    result.raw_sign_text = `[Zone mismatch: sign=${analysis.zone_number}, expected=${sample.zone}] ${result.raw_sign_text}`;
  }

  if (result.restriction_schedule) {
    log(`  Zone ${sample.zone}: Found schedule: "${result.restriction_schedule}" (${analysis.confidence} confidence)`);
  } else {
    log(`  Zone ${sample.zone}: Sign found but couldn't extract schedule. Raw: "${result.raw_sign_text}"`);
    result.error = 'Sign found but schedule not extractable';
  }

  return result;
}

async function upsertResult(supabase: SupabaseClient, result: ExtractionResult): Promise<void> {
  if (!result.restriction_schedule) return;

  // Build the row data using only the columns that exist in the current schema.
  // Core columns (always present): zone, zone_type, restriction_hours, restriction_days,
  //   restriction_schedule, confidence, source, reported_address, notes, updated_at
  // Optional columns (added by migration): raw_sign_text, street_view_url, sample_address, image_urls, extracted_at
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

  // Try with all columns first (if migration was applied)
  const fullRow = {
    ...row,
    raw_sign_text: result.raw_sign_text,
    street_view_url: result.street_view_url,
    sample_address: result.sample_address,
    image_urls: result.image_urls,
    extracted_at: new Date().toISOString(),
  };

  let { error } = await supabase
    .from('permit_zone_hours')
    .upsert(fullRow, { onConflict: 'zone,zone_type' });

  // If it fails (likely missing columns or constraint), fallback to core columns only
  if (error) {
    log(`  Full upsert failed (${error.message}), trying core columns only...`);
    // For tables without unique constraint, try insert then update on conflict
    const { error: coreError } = await supabase
      .from('permit_zone_hours')
      .upsert(row, { onConflict: 'zone,zone_type', ignoreDuplicates: false });

    if (coreError) {
      // Final fallback: try a simple insert (if zone doesn't exist yet)
      const { error: insertError } = await supabase
        .from('permit_zone_hours')
        .insert(row);

      if (insertError) {
        logError(`  DB insert failed for Zone ${result.zone}: ${insertError.message}`);
      }
    }
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
  log(`  Confirmed: ${rows.filter(r => r.confidence === 'confirmed').length}`);
  log(`  AI Extracted: ${rows.filter(r => r.confidence === 'ai_extracted').length}`);
  log(`  Manual: ${rows.filter(r => r.confidence === 'manual').length}`);
  log('');

  // Group by schedule to find common patterns
  const scheduleGroups = new Map<string, string[]>();
  for (const row of rows) {
    const sched = row.restriction_schedule || 'UNKNOWN';
    if (!scheduleGroups.has(sched)) scheduleGroups.set(sched, []);
    scheduleGroups.get(sched)!.push(row.zone);
  }

  log('Schedule Distribution:');
  const sorted = [...scheduleGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [schedule, zones] of sorted) {
    log(`  "${schedule}" — ${zones.length} zone(s): ${zones.slice(0, 10).join(', ')}${zones.length > 10 ? '...' : ''}`);
  }

  log('');
  log('Detailed Results:');
  log(`${'Zone'.padEnd(8)} ${'Schedule'.padEnd(25)} ${'Confidence'.padEnd(14)} ${'Raw Sign Text'.padEnd(50)}`);
  log(`${'─'.repeat(8)} ${'─'.repeat(25)} ${'─'.repeat(14)} ${'─'.repeat(50)}`);

  for (const row of rows) {
    const zone = String(row.zone).padEnd(8);
    const schedule = (row.restriction_schedule || '—').padEnd(25);
    const conf = (row.confidence || '—').padEnd(14);
    const raw = (row.raw_sign_text || '—').substring(0, 50);
    log(`${zone} ${schedule} ${conf} ${raw}`);
  }

  // Generate HTML report
  const htmlPath = path.resolve(__dirname2, '..', 'permit-zone-hours-report.html');

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Permit Zone Hours — Extraction Report</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
    h1 { color: #1a1a2e; }
    .stats { display: flex; gap: 20px; margin: 20px 0; }
    .stat { background: #f0f4f8; padding: 15px 25px; border-radius: 8px; }
    .stat .number { font-size: 2em; font-weight: bold; color: #2563eb; }
    .stat .label { color: #64748b; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th { background: #1a1a2e; color: white; padding: 10px; text-align: left; }
    td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; }
    tr:hover { background: #f8fafc; }
    .confidence-confirmed { color: #16a34a; font-weight: bold; }
    .confidence-ai_extracted { color: #d97706; }
    .confidence-manual { color: #2563eb; }
    .schedule { font-family: monospace; background: #f0f4f8; padding: 2px 6px; border-radius: 3px; }
    .action-btn { padding: 4px 10px; border: 1px solid #e2e8f0; border-radius: 4px; background: white; cursor: pointer; font-size: 0.85em; }
    .action-btn:hover { background: #f0f4f8; }
    .sv-link { color: #2563eb; text-decoration: none; }
    .sv-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Permit Zone Hours — Extraction Report</h1>
  <p>Generated: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}</p>

  <div class="stats">
    <div class="stat">
      <div class="number">${rows.length}</div>
      <div class="label">Total Zones</div>
    </div>
    <div class="stat">
      <div class="number">${rows.filter(r => r.confidence === 'confirmed').length}</div>
      <div class="label">Confirmed</div>
    </div>
    <div class="stat">
      <div class="number">${rows.filter(r => r.confidence === 'ai_extracted').length}</div>
      <div class="label">AI Extracted</div>
    </div>
  </div>

  <h2>Schedule Distribution</h2>
  <table>
    <tr><th>Schedule</th><th>Count</th><th>Zones</th></tr>
    ${sorted.map(([schedule, zones]) => `
    <tr>
      <td class="schedule">${schedule}</td>
      <td>${zones.length}</td>
      <td>${zones.join(', ')}</td>
    </tr>`).join('')}
  </table>

  <h2>All Zones</h2>
  <table>
    <tr>
      <th>Zone</th>
      <th>Type</th>
      <th>Schedule</th>
      <th>Confidence</th>
      <th>Raw Sign Text</th>
      <th>Sample Address</th>
      <th>Street View</th>
    </tr>
    ${rows.map(row => `
    <tr>
      <td><strong>${row.zone}</strong></td>
      <td>${row.zone_type}</td>
      <td class="schedule">${row.restriction_schedule || '—'}</td>
      <td class="confidence-${row.confidence}">${row.confidence}</td>
      <td>${row.raw_sign_text || '—'}</td>
      <td>${row.sample_address || '—'}</td>
      <td>${row.street_view_url ? `<a href="${row.street_view_url}" target="_blank" class="sv-link">View</a>` : '—'}</td>
    </tr>`).join('')}
  </table>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);
  log(`\nHTML report saved to: ${htmlPath}`);
}

// ─── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate environment
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');

  if (missing.length > 0) {
    logError(`Missing environment variables: ${missing.join(', ')}`);
    logError('Ensure .env.prod and .env.local exist in the repo root with these variables.');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  log('=== Permit Zone Hours Collection Pipeline ===');
  log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | Skip existing: ${SKIP_EXISTING}`);

  if (REPORT_ONLY) {
    await generateReport(supabase);
    return;
  }

  // Get all unique zones
  let samples = await getUniqueZones(supabase);

  if (SINGLE_ZONE) {
    samples = samples.filter(s => s.zone === SINGLE_ZONE);
    if (samples.length === 0) {
      logError(`Zone "${SINGLE_ZONE}" not found in parking_permit_zones`);
      process.exit(1);
    }
    log(`Filtering to single zone: ${SINGLE_ZONE}`);
  }

  // Skip zones already in DB if requested
  if (SKIP_EXISTING) {
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

  log(`Processing ${samples.length} zones...\n`);

  const results: ExtractionResult[] = [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    log(`[${i + 1}/${samples.length}] Zone ${sample.zone} — ${sample.sampleAddress}`);

    try {
      const result = await processZone(sample, anthropic);
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
        source: 'street_view_vision',
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

  // Show extracted schedules
  const extracted = results.filter(r => r.restriction_schedule);
  if (extracted.length > 0) {
    log('\nExtracted Schedules:');
    for (const r of extracted) {
      log(`  Zone ${r.zone}: "${r.restriction_schedule}" (raw: "${r.raw_sign_text}")`);
    }
  }

  // Show failures
  const failed = results.filter(r => r.error);
  if (failed.length > 0) {
    log(`\nFailed Zones (${failed.length}):`);
    for (const r of failed) {
      log(`  Zone ${r.zone}: ${r.error}`);
    }
  }

  // Generate report
  if (!DRY_RUN) {
    await generateReport(supabase);
  }

  // Cleanup
  await closeBrowser();

  log('\nDone.');
}

main().catch(async err => {
  logError(`Fatal: ${err}`);
  await closeBrowser();
  process.exit(1);
});
