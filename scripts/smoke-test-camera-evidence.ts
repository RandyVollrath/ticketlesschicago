/**
 * Smoke test: hit the real Chicago camera-ticket evidence portals with real
 * citation numbers from our DB, confirm we get back actual photos and video.
 *
 * Per CLAUDE.md: `npx tsc --noEmit` passing is not sufficient. This script
 * must run to exit code 0 against a real ticket before we can claim the
 * scraper works.
 *
 * Usage: npx tsx scripts/smoke-test-camera-evidence.ts
 *        npx tsx scripts/smoke-test-camera-evidence.ts <citation> <plate>
 */

import { scrapeRedLightEvidence, scrapeSpeedCameraEvidence } from '../lib/camera-evidence-scraper';
import { analyzeCameraEvidence } from '../lib/camera-evidence-analysis';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });

async function main() {
  const overrideCitation = process.argv[2];
  const overridePlate = process.argv[3];

  let citation: string;
  let plate: string;
  let kind: 'red_light' | 'speed_camera';

  if (overrideCitation && overridePlate) {
    citation = overrideCitation;
    plate = overridePlate;
    kind = 'red_light';
    console.log(`Using override: citation=${citation} plate=${plate}`);
  } else {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { data, error } = await supabase
      .from('detected_tickets')
      .select('plate, ticket_number, violation_type, violation_code')
      .or('violation_type.eq.red_light,violation_type.eq.speed_camera')
      .not('ticket_number', 'is', null)
      .limit(5);
    if (error || !data || data.length === 0) {
      console.error('No camera tickets in DB. Pass <citation> <plate> as args.');
      process.exit(2);
    }
    const t = data[0];
    citation = t.ticket_number;
    plate = t.plate;
    kind = (t.violation_type === 'red_light' ? 'red_light' : 'speed_camera') as 'red_light' | 'speed_camera';
    console.log(`Using DB ticket: ${kind} citation=${citation} plate=${plate}`);
  }

  const outDir = `/tmp/camera-evidence-smoke/${citation}`;
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n→ Scraping ${kind} evidence...`);
  const t0 = Date.now();
  const ev =
    kind === 'red_light'
      ? await scrapeRedLightEvidence(citation, plate, { screenshotDir: outDir })
      : await scrapeSpeedCameraEvidence(citation, plate, { screenshotDir: outDir });
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`→ Done in ${elapsed}s`);

  console.log('\n=== RESULT ===');
  console.log(`  source:       ${ev.source}`);
  console.log(`  imageUrls:    ${ev.imageUrls.length}`);
  for (const u of ev.imageUrls.slice(0, 10)) console.log(`    - ${u}`);
  console.log(`  videoUrls:    ${ev.videoUrls.length}`);
  for (const u of ev.videoUrls) console.log(`    - ${u}`);
  console.log(`  images downloaded: ${ev.images.length}  (total ${ev.images.reduce((a, x) => a + x.bytes.length, 0)} bytes)`);
  console.log(`  videos downloaded: ${ev.videos.length}  (total ${ev.videos.reduce((a, x) => a + x.bytes.length, 0)} bytes)`);
  if (ev.notes.length) {
    console.log(`  notes:`);
    for (const n of ev.notes) console.log(`    - ${n}`);
  }

  // Persist artifacts for visual review
  for (let i = 0; i < ev.images.length; i++) {
    const ext = ev.images[i].contentType.split('/')[1]?.split(';')[0] || 'jpg';
    const p = path.join(outDir, `image-${i + 1}.${ext}`);
    fs.writeFileSync(p, ev.images[i].bytes);
    console.log(`  saved: ${p} (${ev.images[i].bytes.length} bytes, ${ev.images[i].contentType})`);
  }
  for (let i = 0; i < ev.videos.length; i++) {
    const ext = ev.videos[i].contentType.split('/')[1]?.split(';')[0] || 'mp4';
    const p = path.join(outDir, `video-${i + 1}.${ext}`);
    fs.writeFileSync(p, ev.videos[i].bytes);
    console.log(`  saved: ${p} (${ev.videos[i].bytes.length} bytes, ${ev.videos[i].contentType})`);
  }

  // PASS only if we got at least one image OR one video
  const scrapeOk = ev.imageUrls.length > 0 || ev.videoUrls.length > 0;
  console.log(`\n${scrapeOk ? '✅ Scrape PASS' : '❌ Scrape FAIL'} — ${scrapeOk ? 'evidence retrieved' : 'no evidence retrieved'}`);

  // Phase 2: run the analyzer on the images
  if (ev.images.length > 0 && process.env.ANTHROPIC_API_KEY) {
    console.log('\n→ Running AI analysis on images...');
    const t1 = Date.now();
    try {
      const findings = await analyzeCameraEvidence(ev.images, {
        expectedPlate: plate,
        violationType: kind,
        violationDate: 'February 4, 2026',
        location: 'unknown',
      });
      const elapsed2 = ((Date.now() - t1) / 1000).toFixed(1);
      console.log(`→ Analysis done in ${elapsed2}s`);
      console.log('\n=== ANALYSIS ===');
      console.log(`  Vehicle plate read:    ${findings.vehicle.visiblePlate} (conf ${findings.vehicle.visiblePlateConfidence})`);
      console.log(`  Vehicle color:         ${findings.vehicle.vehicleColor}`);
      console.log(`  Vehicle body/model:    ${findings.vehicle.vehicleBodyStyle} / ${findings.vehicle.vehicleMakeModel}`);
      console.log(`  Signal state:          ${findings.signal?.signalState} (conf ${findings.signal?.signalStateConfidence ?? 'n/a'})`);
      console.log(`  Location visible:      ${findings.scene.visibleLocation}`);
      console.log(`  No-Turn-on-Red sign:   ${findings.scene.noTurnOnRedSignVisible}`);
      console.log(`  Weather:               ${findings.scene.weatherConditions}`);
      console.log(`  Recommended defense:   ${findings.recommendDefense}`);
      console.log(`  Summary:`);
      console.log(`    ${findings.summary}`);
      console.log(`  Contestable observations: ${findings.contestable.length}`);
      for (const c of findings.contestable) {
        console.log(`    - [${c.supports}] (conf ${c.confidence}) ${c.observation}`);
      }
      fs.writeFileSync(path.join(outDir, 'findings.json'), JSON.stringify(findings, null, 2));
      console.log(`  saved: ${path.join(outDir, 'findings.json')}`);

      // Compare plate
      const plateMatches =
        findings.vehicle.visiblePlate &&
        findings.vehicle.visiblePlate.toUpperCase().replace(/\s/g, '') === plate.toUpperCase().replace(/\s/g, '');
      console.log(`  Plate-match check: ${plateMatches ? '✅ matches ticket plate' : '⚠️ DOES NOT match ticket plate — potential vehicle-ID defense'}`);
    } catch (err: any) {
      console.error(`❌ Analysis FAIL: ${err.message}`);
      process.exit(1);
    }
  } else if (ev.images.length > 0) {
    console.log('\n(Skipping AI analysis — ANTHROPIC_API_KEY not set)');
  }

  process.exit(scrapeOk ? 0 : 1);
}

main().catch(err => {
  console.error('Smoke test crashed:', err);
  process.exit(1);
});
