#!/usr/bin/env npx tsx
/**
 * Autopilot Camera Evidence Scraper
 *
 * Pulls violation photos + video from the City's vendor evidence portals
 * (chicagophotociteweb.com for red-light, violationinfo.com for speed
 * cameras) and AI-analyzes the stills. Caches results in `camera_evidence`
 * so the Vercel-hosted contest-letter generator can read findings without
 * having to run Playwright in a serverless function.
 *
 * Why standalone: Playwright is heavy and not reliable inside Vercel
 * serverless functions (cold-start memory, 50MB code-size cap on the
 * deploy artifact). The existing chicago-portal-scraper.ts runs the same
 * way — via systemd timer on an ops box, NOT on Vercel — and we follow
 * the same pattern here.
 *
 * Schedule: Daily (or whenever the portal scraper runs). Suggested:
 *   ExecStart=/usr/bin/npx tsx /opt/autopilot/scripts/autopilot-scrape-camera-evidence.ts
 *
 * What it does each run:
 *   1. Finds camera-ticket rows in `detected_tickets` (violation_type =
 *      red_light or speed_camera) that don't yet have a row in
 *      `camera_evidence` for that ticket_id.
 *   2. For each, runs the scraper against the City's vendor portal.
 *   3. If photos came back, AI-analyzes them with Claude Vision.
 *   4. Uploads photos + video to Supabase Storage, persists findings.
 *   5. Logs a summary to stdout for the systemd journal.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANTHROPIC_API_KEY  (for AI analysis; if missing, scrape still runs)
 *
 * Optional env vars:
 *   CAMERA_EVIDENCE_MAX_PER_RUN  (default: 25)
 *   CAMERA_EVIDENCE_DELAY_MS     (default: 4000 — be a polite scraper)
 *   CAMERA_EVIDENCE_FORCE        (set to "1" to re-scrape even cached tickets)
 */

import { createClient } from '@supabase/supabase-js';
import { runCameraEvidencePipeline } from '../lib/camera-evidence-pipeline';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MAX_PER_RUN = parseInt(process.env.CAMERA_EVIDENCE_MAX_PER_RUN || '25', 10);
const DELAY_MS = parseInt(process.env.CAMERA_EVIDENCE_DELAY_MS || '4000', 10);
const FORCE = process.env.CAMERA_EVIDENCE_FORCE === '1';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

interface CameraTicket {
  id: string;
  user_id: string;
  plate: string;
  ticket_number: string;
  violation_type: string | null;
  violation_code: string | null;
  violation_date: string | null;
  location: string | null;
}

async function findCameraTicketsNeedingEvidence(): Promise<CameraTicket[]> {
  // Camera tickets: red_light OR speed_camera type, with a ticket number
  // we can search the vendor portal with. Exclude tickets in terminal
  // states (skipped, won, lost, paid) — no point pulling evidence for a
  // resolved ticket.
  const { data: candidates, error } = await supabase
    .from('detected_tickets')
    .select('id, user_id, plate, ticket_number, violation_type, violation_code, violation_date, location, status')
    .or('violation_type.eq.red_light,violation_type.eq.speed_camera')
    .not('ticket_number', 'is', null)
    .not('status', 'in', '(skipped,won,lost,paid,dismissed,upheld)')
    .order('found_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Failed to read detected_tickets:', error.message);
    return [];
  }
  if (!candidates) return [];

  if (FORCE) {
    return candidates.slice(0, MAX_PER_RUN) as CameraTicket[];
  }

  // Filter to ones without a camera_evidence row yet
  const ticketIds = candidates.map((c: any) => c.id);
  const { data: alreadyCached } = await supabase
    .from('camera_evidence' as any)
    .select('ticket_id')
    .in('ticket_id', ticketIds);

  const cachedSet = new Set((alreadyCached || []).map((r: any) => r.ticket_id));
  const needsScrape = candidates.filter((c: any) => !cachedSet.has(c.id));
  return needsScrape.slice(0, MAX_PER_RUN) as CameraTicket[];
}

async function main() {
  console.log(`[${new Date().toISOString()}] autopilot-scrape-camera-evidence starting`);
  console.log(`  max per run: ${MAX_PER_RUN}, delay: ${DELAY_MS}ms, force: ${FORCE}`);

  const todo = await findCameraTicketsNeedingEvidence();
  console.log(`  found ${todo.length} camera ticket(s) needing evidence scrape`);

  if (todo.length === 0) {
    console.log('  nothing to do, exiting');
    return;
  }

  let succeeded = 0;
  let noMedia = 0;
  let failed = 0;

  for (let i = 0; i < todo.length; i++) {
    const t = todo[i];
    const tag = `[${i + 1}/${todo.length}] ${t.violation_type} ${t.ticket_number} (plate ${t.plate})`;
    console.log(`  ${tag}: scraping...`);

    try {
      const result = await runCameraEvidencePipeline(supabase, t, { force: FORCE });

      if (result.persistenceUnavailable) {
        console.error(`  ${tag}: camera_evidence table missing — apply migrations/20260510_create_camera_evidence.sql`);
        failed++;
      } else if (result.noEvidenceAvailable) {
        console.log(`  ${tag}: vendor portal returned no media (ticket may not be in vendor system yet, or wrong plate)`);
        noMedia++;
      } else if (result.evidence) {
        const f = result.evidence.findings;
        const recommended = f?.recommendDefense || 'none';
        const imgs = result.evidence.imagePaths.length;
        const vids = result.evidence.videoPaths.length;
        console.log(`  ${tag}: ${imgs} photo(s) + ${vids} video(s), recommended defense: ${recommended}`);
        succeeded++;
      } else {
        console.log(`  ${tag}: skipped (not a camera ticket?)`);
      }
    } catch (err: any) {
      console.error(`  ${tag}: error — ${err.message}`);
      failed++;
    }

    if (i < todo.length - 1) {
      await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  }

  console.log(`[${new Date().toISOString()}] done: ${succeeded} succeeded, ${noMedia} no-media, ${failed} failed`);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
