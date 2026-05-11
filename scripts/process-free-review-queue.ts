#!/usr/bin/env npx tsx
/**
 * Free Review Queue Processor
 *
 * Picks up rows from `free_review_requests` where status='pending', runs the
 * CHI PAY portal scrape, evaluates each ticket against the contest-kits
 * policy engine + beyond-template detector, and writes the analysis back to
 * the row. The website page polls until status='done'.
 *
 * Runs OUTSIDE Vercel because Playwright is required (~300MB) and Vercel
 * functions cannot host the browser. Run it as a one-shot or via systemd.
 *
 *   npx tsx scripts/process-free-review-queue.ts             # one batch then exit
 *   LOOP=1 npx tsx scripts/process-free-review-queue.ts       # keep polling
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import { lookupPlateOnPortal } from '../lib/chicago-portal-scraper';
import { buildAnalysis } from '../lib/contest-review/build-analysis';
import {
  enrichTicketFromFoia,
  getIssuingOfficerStats,
  getBlockStats,
} from '../lib/contest-review/foia-enrichment';
import type { AutopilotEnrichment } from '../lib/contest-review/beyond-template-arguments';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const WORKER_ID = process.env.WORKER_ID || `free-review-${os.hostname()}-${process.pid}`;
const STALE_CLAIM_MIN = 10;
const POLL_INTERVAL_MS = 8000;
const LOOP = process.env.LOOP === '1' || process.env.LOOP === 'true';

async function claimOne(): Promise<{ id: string; plate: string; state: string; last_name: string } | null> {
  // Release stale claims first
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MIN * 60 * 1000).toISOString();
  await supabase
    .from('free_review_requests')
    .update({ status: 'pending', worker_id: null, claimed_at: null })
    .eq('status', 'processing')
    .lt('claimed_at', staleCutoff);

  // Atomic-ish claim: update one pending row to processing
  const { data: candidates } = await supabase
    .from('free_review_requests')
    .select('id, plate, state, last_name')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!candidates || candidates.length === 0) return null;
  const row = candidates[0];

  const { data: claimed, error } = await supabase
    .from('free_review_requests')
    .update({
      status: 'processing',
      worker_id: WORKER_ID,
      claimed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', 'pending')
    .select('id, plate, state, last_name')
    .maybeSingle();

  if (error || !claimed) return null;
  return claimed;
}

async function processOne(row: { id: string; plate: string; state: string; last_name: string }) {
  console.log(`[${row.id}] starting portal lookup for ${row.plate} (${row.state}) / ${row.last_name}`);
  const lookup = await lookupPlateOnPortal(row.plate, row.state, row.last_name);

  if (lookup.error) {
    console.error(`[${row.id}] portal error: ${lookup.error}`);
    await supabase
      .from('free_review_requests')
      .update({
        status: 'error',
        error_message: lookup.error.slice(0, 500),
        completed_at: new Date().toISOString(),
        worker_id: null,
        claimed_at: null,
      })
      .eq('id', row.id);
    return;
  }

  // For each ticket the portal returned, try to enrich it from FOIA
  // (cited address + officer + officer/block dismissal stats). This is the
  // Autopilot-exclusive tier — data the user can't get on their own.
  const enrichmentByTicket = new Map<string, AutopilotEnrichment>();
  for (const t of lookup.tickets) {
    const foia = enrichTicketFromFoia(t.ticket_number);
    if (!foia) {
      enrichmentByTicket.set(t.ticket_number, { foundInFoia: false });
      continue;
    }
    const officer = foia.officer && foia.violationDesc
      ? getIssuingOfficerStats(foia.officer, foia.violationDesc)
      : null;
    const block = getBlockStats(foia);
    enrichmentByTicket.set(t.ticket_number, {
      foundInFoia: true,
      citedAddress: foia.fullAddress,
      officerId: foia.officer,
      officerOverallDismissalRate: officer?.dismissalRate ?? null,
      officerOverallContested: officer?.totalContested ?? null,
      officerSameTypeDismissalRate: officer?.sameTypeDismissalRate ?? null,
      officerSameTypeContested: officer?.sameTypeContested ?? null,
      blockLabel: block?.blockLabel ?? null,
      blockTotalContested: block?.ticketsAtBlock ?? null,
      blockNotLiable: block?.notLiableAtBlock ?? null,
      blockDismissalRate: block?.dismissalRateAtBlock ?? null,
    });
  }

  const analysis = buildAnalysis(
    lookup,
    {
      queriedPlate: row.plate,
      queriedState: row.state,
      queriedLastName: row.last_name,
    },
    enrichmentByTicket,
  );

  console.log(`[${row.id}] done — ${analysis.totalTickets} tickets, ${analysis.perTicket.filter(t => t.recommendation === 'contest').length} worth contesting`);

  await supabase
    .from('free_review_requests')
    .update({
      status: 'done',
      portal_response: lookup as any,
      analysis: analysis as any,
      completed_at: new Date().toISOString(),
      worker_id: null,
      claimed_at: null,
    })
    .eq('id', row.id);
}

async function main() {
  console.log(`[free-review-worker] starting as ${WORKER_ID} (LOOP=${LOOP})`);
  do {
    const row = await claimOne();
    if (!row) {
      if (!LOOP) {
        console.log('[free-review-worker] no pending rows, exiting');
        return;
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    try {
      await processOne(row);
    } catch (err: any) {
      console.error(`[${row.id}] processing failed:`, err?.message || err);
      await supabase
        .from('free_review_requests')
        .update({
          status: 'error',
          error_message: (err?.message || 'Unknown error').slice(0, 500),
          completed_at: new Date().toISOString(),
          worker_id: null,
          claimed_at: null,
        })
        .eq('id', row.id);
    }
  } while (LOOP);
}

main().catch(err => {
  console.error('[free-review-worker] fatal:', err);
  process.exit(1);
});
