#!/usr/bin/env npx tsx
/**
 * Weekly recheck for free-review monitor opt-ins.
 *
 * The /free-ticket-review form lets users tick a "Keep watching my plate"
 * box. Their row in free_review_requests is then re-scraped every Monday
 * morning by this script (run via the user-systemd timer
 * free-review-recheck.timer). For each due row:
 *
 *   1. If their email is now a paid Autopilot customer, stop monitoring
 *      silently (became_paid). Their own paid pipeline handles things —
 *      we don't want them getting duplicate free-tier nags.
 *
 *   2. Otherwise re-scrape the CHI PAY portal. Compare the returned ticket
 *      numbers against last_known_ticket_numbers. If anything new shows
 *      up (i.e. a ticket the city portal didn't know about during the
 *      previous review — exactly Amanda Edwards' case where she got a
 *      ticket the morning she signed up and the portal didn't yet show
 *      it), send a "new ticket detected" email with a link back to her
 *      results page and an unsubscribe link.
 *
 *   3. Bump last_rechecked_at + recheck_count either way so the next
 *      Monday's run doesn't re-process this row.
 *
 * Like process-free-review-queue.ts, this runs OUTSIDE Vercel because
 * Playwright is required for the CHI PAY scrape.
 *
 *   npx tsx scripts/recheck-free-review-monitors.ts            # do real work
 *   DRY_RUN=1 npx tsx scripts/recheck-free-review-monitors.ts  # report only
 *
 * Env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { lookupPlateOnPortal } from '../lib/chicago-portal-scraper';
import { buildAnalysis } from '../lib/contest-review/build-analysis';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

// Recheck cadence is weekly Monday morning. We pull anything that hasn't
// been checked in the last 6 days so a Monday run that limps into Tuesday
// (Playwright hiccup, machine reboot, etc.) still picks up the misses.
const STALENESS_HOURS = 6 * 24;

interface MonitorRow {
  id: string;
  plate: string;
  state: string;
  last_name: string;
  email: string;
  last_known_ticket_numbers: string[] | null;
  recheck_count: number | null;
  unsubscribe_token: string | null;
}

async function findDueRows(): Promise<MonitorRow[]> {
  const cutoff = new Date(Date.now() - STALENESS_HOURS * 60 * 60 * 1000).toISOString();
  // Two passes because Supabase REST can't express
  //   last_rechecked_at IS NULL OR last_rechecked_at < cutoff
  // in a single .or() the way we'd like with non-null filtering on email.
  const [neverChecked, staleChecked] = await Promise.all([
    supabase
      .from('free_review_requests')
      .select('id, plate, state, last_name, email, last_known_ticket_numbers, recheck_count, unsubscribe_token')
      .eq('monitor_enabled', true)
      .not('email', 'is', null)
      .is('last_rechecked_at', null)
      .limit(500),
    supabase
      .from('free_review_requests')
      .select('id, plate, state, last_name, email, last_known_ticket_numbers, recheck_count, unsubscribe_token')
      .eq('monitor_enabled', true)
      .not('email', 'is', null)
      .lt('last_rechecked_at', cutoff)
      .limit(500),
  ]);
  const all = [...(neverChecked.data || []), ...(staleChecked.data || [])];
  // Dedupe defensively in case the two queries ever overlap.
  const seen = new Set<string>();
  return all.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return !!r.email;
  }) as MonitorRow[];
}

async function isEmailPaidCustomer(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_profiles')
    .select('user_id, is_paid')
    .eq('email', email)
    .eq('is_paid', true)
    .limit(1);
  return (data?.length || 0) > 0;
}

async function stopMonitoring(rowId: string, reason: 'became_paid' | 'unsubscribed' | 'no_email'): Promise<void> {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would stop monitoring ${rowId} (${reason})`);
    return;
  }
  await supabase
    .from('free_review_requests')
    .update({
      monitor_enabled: false,
      monitor_stopped_reason: reason,
      monitor_stopped_at: new Date().toISOString(),
    })
    .eq('id', rowId);
}

async function sendNewTicketEmail(
  row: MonitorRow,
  newTicketCount: number,
  totalAmountDue: number,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    console.log(`[${row.id}] RESEND_API_KEY not set — skipping new-ticket email`);
    return;
  }
  if (DRY_RUN) {
    console.log(`[DRY_RUN] would email ${row.email}: ${newTicketCount} new ticket(s) on plate ${row.plate}, $${totalAmountDue.toFixed(2)} outstanding`);
    return;
  }
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const resultsLink = `https://www.autopilotamerica.com/free-ticket-review?id=${row.id}`;
  const unsubLink = row.unsubscribe_token
    ? `https://www.autopilotamerica.com/api/contest/free-review-unsubscribe?token=${row.unsubscribe_token}`
    : null;
  const subject = newTicketCount === 1
    ? `New ticket spotted on plate ${row.plate}`
    : `${newTicketCount} new tickets spotted on plate ${row.plate}`;
  const headline = newTicketCount === 1
    ? `The City of Chicago just posted a new ticket on your plate.`
    : `The City of Chicago just posted ${newTicketCount} new tickets on your plate.`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0F172A;">
      <h2 style="font-size: 20px; margin: 0 0 12px;">${headline}</h2>
      <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 12px;">
        You asked us to keep watching plate <strong>${row.plate}</strong>, and a re-check of the city's
        payment portal just turned up <strong>${newTicketCount === 1 ? 'a new ticket' : `${newTicketCount} new tickets`}</strong>
        ${totalAmountDue > 0 ? `(total $${totalAmountDue.toFixed(2)} outstanding) ` : ''}that weren't on file when
        you first ran the review.
      </p>
      <p style="font-size: 15px; line-height: 1.6; color: #334155; margin: 0 0 16px;">
        Click below for an updated, ticket-by-ticket contest review — including which ones are still inside
        the mail-contest window.
      </p>
      <p style="margin: 0 0 24px;">
        <a href="${resultsLink}" style="display: inline-block; padding: 12px 18px; background: #2563EB; color: #fff; font-weight: 700; text-decoration: none; border-radius: 8px;">See the updated review</a>
      </p>
      <p style="font-size: 13px; color: #334155; line-height: 1.6; margin: 0 0 16px;">
        Want us to actually file the contest, FOIA the city's records, and track each ticket to a decision?
        That's what Autopilot does — $79/year, includes contest filing plus street-cleaning, snow-ban, and
        renewal alerts going forward.
      </p>
      <p style="font-size: 12px; color: #64748B; line-height: 1.6; margin-top: 24px;">
        Autopilot America — Chicago parking ticket protection
      </p>
      ${unsubLink ? `
        <p style="font-size: 11px; color: #94A3B8; line-height: 1.6; margin-top: 16px;">
          Don't want these check-in emails? <a href="${unsubLink}" style="color: #64748B;">Unsubscribe from plate watching</a> — your initial review is unaffected.
        </p>
      ` : ''}
    </div>
  `;
  try {
    await resend.emails.send({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: row.email,
      subject,
      html,
    });
    console.log(`[${row.id}] new-ticket email sent to ${row.email} (${newTicketCount} new)`);
  } catch (err: any) {
    console.warn(`[${row.id}] failed to send new-ticket email: ${err?.message || err}`);
  }
}

type RecheckOutcome = 'stopped_paid' | 'no_new_tickets' | 'new_tickets_emailed' | 'portal_error';

async function recheckOne(row: MonitorRow): Promise<RecheckOutcome> {
  console.log(`[${row.id}] rechecking ${row.plate} (${row.state}) for ${row.email}`);

  if (await isEmailPaidCustomer(row.email)) {
    console.log(`[${row.id}] email ${row.email} is a paid Autopilot customer — stopping monitor (became_paid)`);
    await stopMonitoring(row.id, 'became_paid');
    return 'stopped_paid';
  }

  const lookup = await lookupPlateOnPortal(row.plate, row.state, row.last_name);

  if (lookup.error) {
    console.warn(`[${row.id}] portal error on recheck: ${lookup.error}`);
    if (!DRY_RUN) {
      await supabase
        .from('free_review_requests')
        .update({
          last_rechecked_at: new Date().toISOString(),
          recheck_count: (row.recheck_count || 0) + 1,
        })
        .eq('id', row.id);
    }
    return 'portal_error';
  }

  const currentTicketNumbers = lookup.tickets
    .map(t => t.ticket_number)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  const previousSet = new Set(row.last_known_ticket_numbers || []);
  const newTickets = currentTicketNumbers.filter(n => !previousSet.has(n));

  if (newTickets.length === 0) {
    console.log(`[${row.id}] no new tickets (${currentTicketNumbers.length} on file, all already seen)`);
    if (!DRY_RUN) {
      await supabase
        .from('free_review_requests')
        .update({
          last_rechecked_at: new Date().toISOString(),
          recheck_count: (row.recheck_count || 0) + 1,
        })
        .eq('id', row.id);
    }
    return 'no_new_tickets';
  }

  // New tickets found. Re-run buildAnalysis without FOIA/311/DOT enrichment
  // — that's the heavy initial-review path — so the link in the email lands
  // on a fresh results page reflecting the new tickets.
  const analysis = buildAnalysis(
    lookup,
    { queriedPlate: row.plate, queriedState: row.state, queriedLastName: row.last_name },
    new Map(),
  );

  console.log(`[${row.id}] ${newTickets.length} NEW ticket(s) detected: ${newTickets.join(', ')}`);

  if (!DRY_RUN) {
    await supabase
      .from('free_review_requests')
      .update({
        portal_response: lookup as any,
        analysis: analysis as any,
        last_rechecked_at: new Date().toISOString(),
        recheck_count: (row.recheck_count || 0) + 1,
        last_known_ticket_numbers: currentTicketNumbers,
      })
      .eq('id', row.id);
  }

  await sendNewTicketEmail(row, newTickets.length, analysis.totalAmountDue);
  return 'new_tickets_emailed';
}

async function main() {
  console.log(`[free-review-recheck] starting${DRY_RUN ? ' (DRY_RUN)' : ''}`);
  const rows = await findDueRows();
  console.log(`[free-review-recheck] ${rows.length} row(s) due for recheck`);

  const counts: Record<RecheckOutcome | 'exception', number> = {
    stopped_paid: 0,
    no_new_tickets: 0,
    new_tickets_emailed: 0,
    portal_error: 0,
    exception: 0,
  };

  for (const row of rows) {
    try {
      const outcome = await recheckOne(row);
      counts[outcome]++;
    } catch (err: any) {
      console.error(`[${row.id}] recheck failed: ${err?.message || err}`);
      counts.exception++;
    }
  }

  console.log(
    `[free-review-recheck] done — ` +
    `stopped_paid=${counts.stopped_paid}, ` +
    `no_new_tickets=${counts.no_new_tickets}, ` +
    `new_ticket_emails=${counts.new_tickets_emailed}, ` +
    `portal_errors=${counts.portal_error}, ` +
    `exceptions=${counts.exception}`,
  );
}

main().catch(err => {
  console.error('[free-review-recheck] fatal:', err);
  process.exit(1);
});
