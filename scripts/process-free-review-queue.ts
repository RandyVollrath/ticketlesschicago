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
import { SIGN_PHOTO_CODES, type AutopilotEnrichment } from '../lib/contest-review/beyond-template-arguments';
import { findRecentSignComplaints } from '../lib/contest-review/cdot-311-enrichment';
import { classifyPortalViolation } from '../lib/contest-review/violation-classifier';

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

/**
 * FOIA dates come in "M/D/YYYY H:MM:SS AM/PM" format (e.g. "4/3/2024 11:29:46 AM").
 * Convert to ISO yyyy-mm-dd for the 311 SODA query, which uses ISO timestamps.
 */
function foiaDateToIso(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

/**
 * If the user supplied an email and the review finished cleanly, send a
 * results-ready email with a link back to the page (which loads by ?id=…).
 * Quiet failure mode: never block the queue on a Resend hiccup.
 */
async function maybeSendResultsEmail(
  rowId: string,
  email: string | null,
  plate: string,
  totalTickets: number,
  worthContestingCount: number,
): Promise<void> {
  if (!email) return;
  if (!process.env.RESEND_API_KEY) {
    console.log(`[${rowId}] RESEND_API_KEY not set — skipping email`);
    return;
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const link = `https://www.autopilotamerica.com/free-ticket-review?id=${rowId}`;
  const headline = totalTickets === 0
    ? `No open tickets on plate ${plate}`
    : worthContestingCount > 0
      ? `${worthContestingCount} ticket${worthContestingCount === 1 ? '' : 's'} worth contesting on plate ${plate}`
      : `Review ready for plate ${plate}`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0F172A;">
      <h2 style="font-size: 20px; margin: 0 0 12px;">Your free ticket contest review is ready</h2>
      <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 16px;">
        ${headline}. We pulled every parking, red-light, and speed-camera ticket the city has on file
        for your plate and flagged the specific arguments worth running on each one.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${link}" style="display: inline-block; padding: 12px 18px; background: #2563EB; color: #fff; font-weight: 700; text-decoration: none; border-radius: 8px;">View your results</a>
      </p>
      <p style="font-size: 12px; color: #64748B; line-height: 1.6;">
        Or paste this link into a browser: <br/>
        <code style="font-size: 11px; word-break: break-all;">${link}</code>
      </p>
      <p style="font-size: 12px; color: #64748B; line-height: 1.6; margin-top: 24px;">
        Autopilot America — Chicago parking ticket protection
      </p>
    </div>
  `;
  try {
    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: email,
      subject: headline,
      html,
    });
    console.log(`[${rowId}] results email sent to ${email}`);
  } catch (err: any) {
    console.warn(`[${rowId}] failed to send results email: ${err?.message || err}`);
  }
}

async function claimOne(): Promise<{ id: string; plate: string; state: string; last_name: string; email: string | null } | null> {
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
    .select('id, plate, state, last_name, email')
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
    .select('id, plate, state, last_name, email')
    .maybeSingle();

  if (error || !claimed) return null;
  return claimed;
}

async function processOne(row: { id: string; plate: string; state: string; last_name: string; email: string | null }) {
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

    // 311 sign-repair enrichment for sign-based parking violations.
    // We hit the public Chicago Open Data 311 dataset to find documented
    // sign-repair work orders on the cited block face. Quiet failure —
    // network blip should never break the analysis.
    //
    // Match against the CLASSIFIED violation code (dashed format like
    // "9-64-010"), not the raw FOIA code ("0964010B"). The classifier
    // normalizes — SIGN_PHOTO_CODES uses the same dashed format.
    let signOpen = 0;
    let signRecent = 0;
    let signTop: string | null = null;
    const classified = classifyPortalViolation(t.violation_description, t.ticket_type);
    if (
      classified.violationCode &&
      SIGN_PHOTO_CODES[classified.violationCode] &&
      foia.streetNum &&
      foia.streetDir &&
      foia.streetName &&
      foia.issueDatetime
    ) {
      const iso = foiaDateToIso(foia.issueDatetime);
      const num = parseInt(foia.streetNum, 10);
      if (iso && Number.isFinite(num)) {
        try {
          const cdot = await findRecentSignComplaints({
            streetNumber: num,
            streetDirection: foia.streetDir,
            streetName: foia.streetName,
            ticketIsoDate: iso,
          });
          if (cdot) {
            signOpen = cdot.signComplaints.filter(s => s.openAtTicketTime).length;
            signRecent = cdot.signComplaints.filter(s => !s.openAtTicketTime).length;
            const top =
              cdot.signComplaints.find(s => s.openAtTicketTime) || cdot.signComplaints[0];
            signTop = top?.srNumber ?? null;
            if (signOpen + signRecent > 0) {
              console.log(`[${row.id}] ${t.ticket_number}: 311 sign-repair hits — ${signOpen} open, ${signRecent} recent closed @ ${num} ${foia.streetDir} ${foia.streetName}`);
            }
          }
        } catch (err: any) {
          console.warn(`[${row.id}] ${t.ticket_number}: 311 lookup failed: ${err?.message || err}`);
        }
      }
    }

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
      signComplaintsOpenAtTicketTime: signOpen,
      signComplaintsRecentClosed: signRecent,
      signComplaintTopSrNumber: signTop,
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

  const worthContesting = analysis.perTicket.filter(t => t.recommendation === 'contest').length;
  await maybeSendResultsEmail(row.id, row.email, row.plate, analysis.totalTickets, worthContesting);
}

async function writeHeartbeat() {
  try {
    const [pending, processing] = await Promise.all([
      supabase.from('free_review_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('free_review_requests').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
    ]);
    await supabase
      .from('free_review_worker_heartbeat')
      .upsert(
        {
          worker_id: WORKER_ID,
          last_seen_at: new Date().toISOString(),
          pending_count: pending.count ?? 0,
          processing_count: processing.count ?? 0,
          worker_version: '2026-05-12',
        },
        { onConflict: 'worker_id' },
      );
  } catch {
    /* heartbeat is advisory — never block the loop */
  }
}

async function main() {
  console.log(`[free-review-worker] starting as ${WORKER_ID} (LOOP=${LOOP})`);
  await writeHeartbeat();
  do {
    await writeHeartbeat();
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
