#!/usr/bin/env npx ts-node
/**
 * Autopilot Outcome Checker
 *
 * After contest letters are mailed, this script periodically re-checks
 * the Chicago payment portal to see if tickets were dismissed or upheld.
 *
 * Flow:
 * 1. Fetch all detected_tickets with status='mailed' and no contest_outcome
 * 2. Group by plate (so we do one portal lookup per plate, not per ticket)
 * 3. Scrape the portal for each plate
 * 4. Match returned tickets against our mailed ones
 * 5. Update outcomes:
 *    - hearing_disposition = 'Not Liable' or 'Dismissed' → contest WON
 *    - hearing_disposition = 'Liable' → contest LOST
 *    - Ticket no longer appears in portal → likely dismissed or paid
 *    - Still showing with no disposition → still pending
 *
 * Schedule: Weekly (e.g., every Wednesday) via systemd timer
 * Start checking: 21 days after mailing (city needs time to process)
 * Stop checking: After 120 days or outcome found
 *
 * Run: npx ts-node scripts/autopilot-check-outcomes.ts
 */

import { createClient } from '@supabase/supabase-js';
import { lookupMultiplePlates, LookupResult, PortalTicket } from '../lib/chicago-portal-scraper';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const requiredEnvVars = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Configuration
const MIN_DAYS_AFTER_MAILING = 21;  // Don't check until 21 days after mailing
const MAX_DAYS_AFTER_MAILING = 120; // Stop checking after 120 days
const MAX_PLATES_PER_RUN = 30;
const DELAY_BETWEEN_LOOKUPS_MS = 5000;
const SCREENSHOT_DIR = path.resolve(__dirname, '../debug-screenshots/outcome-checks');

interface MailedTicket {
  id: string;
  user_id: string;
  plate: string;
  state: string;
  ticket_number: string;
  violation_type: string;
  violation_description: string | null;
  amount: number | null;
  mailed_at: string; // From contest_letters.mailed_at
  last_outcome_check_at: string | null;
  outcome_check_count: number;
}

/**
 * Determine the contest outcome from portal data
 */
function determineOutcome(portalTicket: PortalTicket | null): {
  outcome: string;
  hearingDisposition: string | null;
} {
  if (!portalTicket) {
    // Ticket no longer appears on portal — likely dismissed or paid
    return { outcome: 'disappeared', hearingDisposition: null };
  }

  const disposition = portalTicket.hearing_disposition?.toLowerCase().trim() || '';
  const queue = portalTicket.ticket_queue?.toLowerCase().trim() || '';

  // Clear wins
  if (disposition === 'not liable' || disposition === 'dismissed') {
    return {
      outcome: 'dismissed',
      hearingDisposition: portalTicket.hearing_disposition,
    };
  }

  // Clear losses
  if (disposition === 'liable' || disposition === 'finding of liability') {
    return {
      outcome: 'liable',
      hearingDisposition: portalTicket.hearing_disposition,
    };
  }

  // Paid (user gave up and paid)
  if (queue === 'paid' || portalTicket.balance_due === 0) {
    return { outcome: 'paid', hearingDisposition: portalTicket.hearing_disposition };
  }

  // Still pending — no outcome yet
  return { outcome: 'pending', hearingDisposition: portalTicket.hearing_disposition };
}

/**
 * Send outcome notification email to user
 */
async function sendOutcomeNotification(
  userId: string,
  ticketNumber: string,
  outcome: string,
  amount: number | null
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (!userData?.user?.email) return;

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('first_name')
    .eq('user_id', userId)
    .single();

  const firstName = profile?.first_name || 'there';
  const email = userData.user.email;

  const isWin = outcome === 'dismissed';
  const amountStr = amount ? `$${amount.toFixed(2)}` : '';

  const subject = isWin
    ? `Your ticket #${ticketNumber} was DISMISSED! ${amountStr} saved`
    : `Update on ticket #${ticketNumber} contest`;

  const bodyHtml = isWin
    ? `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #059669 0%, #10B981 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0; text-align: center;">
          <h1 style="margin: 0; font-size: 28px;">Ticket Dismissed!</h1>
          ${amountStr ? `<p style="margin: 12px 0 0; font-size: 22px; font-weight: bold;">${amountStr} saved</p>` : ''}
        </div>
        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; color: #374151;">Hi ${firstName},</p>
          <p style="font-size: 16px; color: #374151;">
            Great news! The City of Chicago has <strong>dismissed</strong> your parking ticket #${ticketNumber}.
            Your contest letter worked — you don't owe anything on this ticket.
          </p>
          <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
            This is what Autopilot is all about. We'll keep watching your plates for new tickets.
          </p>
        </div>
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #6B7280; color: white; padding: 24px; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">Contest Update</h1>
          <p style="margin: 8px 0 0; opacity: 0.9;">Ticket #${ticketNumber}</p>
        </div>
        <div style="padding: 24px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px; color: #374151;">Hi ${firstName},</p>
          <p style="font-size: 16px; color: #374151;">
            Unfortunately, the city ruled your ticket #${ticketNumber} as <strong>${outcome === 'liable' ? 'liable' : outcome}</strong>.
            ${outcome === 'liable' ? 'You may still be able to appeal this decision — check your mail for instructions from the city.' : ''}
          </p>
          <p style="font-size: 14px; color: #6b7280; margin-top: 20px;">
            We'll keep monitoring your plates and contesting any future tickets.
          </p>
        </div>
      </div>
    `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [email],
        subject,
        html: bodyHtml,
      }),
    });
    console.log(`    Sent ${isWin ? 'WIN' : 'outcome'} notification to ${email}`);
  } catch (err: any) {
    console.error(`    Failed to send outcome notification: ${err.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  console.log('============================================');
  console.log('  Autopilot Outcome Checker');
  console.log(`  ${new Date().toLocaleString()}`);
  console.log('============================================\n');

  // Create screenshot directory
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const now = new Date();
  const minMailDate = new Date(now.getTime() - MAX_DAYS_AFTER_MAILING * 24 * 60 * 60 * 1000);
  const maxMailDate = new Date(now.getTime() - MIN_DAYS_AFTER_MAILING * 24 * 60 * 60 * 1000);

  // Find tickets that need outcome checking:
  // - Letter was mailed (status = 'mailed')
  // - No outcome yet
  // - Mailed between 21 and 120 days ago
  // - Not checked in the last 5 days (avoid hammering portal)
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();

  const { data: mailedTickets, error: fetchError } = await supabaseAdmin
    .from('detected_tickets')
    .select(`
      id,
      user_id,
      plate,
      state,
      ticket_number,
      violation_type,
      violation_description,
      amount,
      last_outcome_check_at,
      outcome_check_count,
      contest_letters!inner (
        mailed_at
      )
    `)
    .eq('status', 'mailed')
    .is('contest_outcome', null)
    .not('contest_letters.mailed_at', 'is', null)
    .gte('contest_letters.mailed_at', minMailDate.toISOString())
    .lte('contest_letters.mailed_at', maxMailDate.toISOString())
    .or(`last_outcome_check_at.is.null,last_outcome_check_at.lt.${fiveDaysAgo}`)
    .order('last_outcome_check_at', { ascending: true, nullsFirst: true })
    .limit(100);

  if (fetchError) {
    console.error('Error fetching mailed tickets:', fetchError.message);
    process.exit(1);
  }

  if (!mailedTickets || mailedTickets.length === 0) {
    console.log('No tickets need outcome checking right now.');
    console.log(`  (Checks tickets mailed ${MIN_DAYS_AFTER_MAILING}-${MAX_DAYS_AFTER_MAILING} days ago, not checked in 5+ days)`);
    process.exit(0);
  }

  console.log(`Found ${mailedTickets.length} tickets to check outcomes for\n`);

  // Group by plate+state (one portal lookup per plate)
  const plateGroups = new Map<string, MailedTicket[]>();
  for (const ticket of mailedTickets) {
    const key = `${ticket.plate.toUpperCase()}|${ticket.state.toUpperCase()}`;
    if (!plateGroups.has(key)) {
      plateGroups.set(key, []);
    }
    plateGroups.get(key)!.push({
      ...ticket,
      mailed_at: (ticket as any).contest_letters?.mailed_at || '',
    });
  }

  console.log(`Grouped into ${plateGroups.size} unique plates\n`);

  // Get last names for portal lookup
  const userIds = [...new Set(mailedTickets.map(t => t.user_id))];
  const { data: profiles } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, last_name')
    .in('user_id', userIds);

  const lastNameMap = new Map<string, string>();
  for (const p of profiles || []) {
    lastNameMap.set(p.user_id, p.last_name || 'Owner');
  }

  // Build lookup list (limit to MAX_PLATES_PER_RUN)
  const lookupEntries = [...plateGroups.entries()].slice(0, MAX_PLATES_PER_RUN);
  const lookupPlates = lookupEntries.map(([key, tickets]) => {
    const [plate, state] = key.split('|');
    const userId = tickets[0].user_id;
    return {
      plate,
      state,
      lastName: lastNameMap.get(userId) || 'Owner',
      tickets,
    };
  });

  console.log(`Looking up ${lookupPlates.length} plates on portal...\n`);

  // Run portal lookups
  const results = await lookupMultiplePlates(
    lookupPlates.map(p => ({ plate: p.plate, state: p.state, lastName: p.lastName })),
    {
      screenshotDir: SCREENSHOT_DIR,
      delayBetweenMs: DELAY_BETWEEN_LOOKUPS_MS,
      maxPlates: MAX_PLATES_PER_RUN,
    }
  );

  // Process results
  let totalChecked = 0;
  let totalDismissed = 0;
  let totalLiable = 0;
  let totalPending = 0;
  let totalDisappeared = 0;
  let totalErrors = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const plateInfo = lookupPlates[i];

    if (result.error) {
      console.log(`  ${result.plate}: ERROR - ${result.error}`);
      totalErrors++;

      // Still mark as checked so we don't retry immediately
      for (const ticket of plateInfo.tickets) {
        await supabaseAdmin
          .from('detected_tickets')
          .update({
            last_outcome_check_at: new Date().toISOString(),
            outcome_check_count: (ticket.outcome_check_count || 0) + 1,
          })
          .eq('id', ticket.id);
      }
      continue;
    }

    // Build a map of portal tickets by ticket_number for quick lookup
    const portalTicketMap = new Map<string, PortalTicket>();
    for (const pt of result.tickets) {
      portalTicketMap.set(pt.ticket_number, pt);
    }

    // Check each of our mailed tickets against portal results
    for (const ticket of plateInfo.tickets) {
      totalChecked++;
      const portalTicket = portalTicketMap.get(ticket.ticket_number) || null;
      const { outcome, hearingDisposition } = determineOutcome(portalTicket);

      const now = new Date().toISOString();

      if (outcome === 'pending') {
        // Still waiting — just update check timestamp
        totalPending++;
        console.log(`  ${ticket.ticket_number}: Still pending (queue: ${portalTicket?.ticket_queue || 'unknown'})`);

        await supabaseAdmin
          .from('detected_tickets')
          .update({
            last_outcome_check_at: now,
            outcome_check_count: (ticket.outcome_check_count || 0) + 1,
            hearing_disposition: hearingDisposition,
          })
          .eq('id', ticket.id);

      } else {
        // We have an outcome!
        const isWin = outcome === 'dismissed' || outcome === 'disappeared';

        if (outcome === 'dismissed') totalDismissed++;
        else if (outcome === 'liable') totalLiable++;
        else if (outcome === 'disappeared') totalDisappeared++;

        const outcomeLabel = outcome === 'dismissed' ? 'DISMISSED'
          : outcome === 'liable' ? 'LIABLE'
          : outcome === 'paid' ? 'PAID'
          : outcome === 'disappeared' ? 'DISAPPEARED (likely dismissed)'
          : outcome.toUpperCase();

        console.log(`  ${ticket.ticket_number}: ${outcomeLabel}${hearingDisposition ? ` (${hearingDisposition})` : ''}`);

        // Update ticket record
        await supabaseAdmin
          .from('detected_tickets')
          .update({
            status: isWin ? 'dismissed' : (outcome === 'paid' ? 'paid' : 'upheld'),
            contest_outcome: outcome,
            contest_outcome_date: now,
            contest_outcome_source: 'portal_check',
            hearing_disposition: hearingDisposition,
            last_outcome_check_at: now,
            outcome_check_count: (ticket.outcome_check_count || 0) + 1,
          })
          .eq('id', ticket.id);

        // Update contest_letters status
        await supabaseAdmin
          .from('contest_letters')
          .update({
            status: isWin ? 'won' : 'lost',
          })
          .eq('ticket_id', ticket.id);

        // Audit log
        await supabaseAdmin
          .from('ticket_audit_log')
          .insert({
            ticket_id: ticket.id,
            user_id: ticket.user_id,
            action: 'outcome_detected',
            details: {
              outcome,
              hearing_disposition: hearingDisposition,
              source: 'portal_check',
              portal_data: portalTicket ? {
                ticket_queue: portalTicket.ticket_queue,
                balance_due: portalTicket.balance_due,
                current_amount_due: portalTicket.current_amount_due,
              } : { not_found: true },
              days_since_mailed: Math.floor(
                (Date.now() - new Date(ticket.mailed_at).getTime()) / (24 * 60 * 60 * 1000)
              ),
            },
            performed_by: 'outcome_checker',
          });

        // Send notification to user
        await sendOutcomeNotification(
          ticket.user_id,
          ticket.ticket_number,
          outcome,
          ticket.amount
        );

        // Send admin notification for wins
        if (isWin && process.env.RESEND_API_KEY) {
          const amountSaved = ticket.amount ? `$${ticket.amount.toFixed(2)}` : 'Unknown';
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: ['randyvollrath@gmail.com'],
                subject: `WIN: Ticket ${ticket.ticket_number} ${outcomeLabel} (${amountSaved} saved)`,
                html: `
                  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: #059669; color: white; padding: 16px 24px; border-radius: 8px;">
                      <h2 style="margin: 0;">Contest Won! ${amountSaved} saved</h2>
                      <p style="margin: 4px 0 0;">Ticket ${ticket.ticket_number} — ${ticket.violation_type?.replace(/_/g, ' ')}</p>
                    </div>
                    <div style="padding: 16px;">
                      <p><strong>Outcome:</strong> ${outcomeLabel}</p>
                      <p><strong>Hearing Disposition:</strong> ${hearingDisposition || 'N/A'}</p>
                      <p><strong>Days since mailed:</strong> ${Math.floor((Date.now() - new Date(ticket.mailed_at).getTime()) / (24 * 60 * 60 * 1000))}</p>
                    </div>
                  </div>
                `,
              }),
            });
          } catch (err: any) {
            console.error(`    Admin notification failed: ${err.message}`);
          }
        }
      }
    }
  }

  // Log the run
  await supabaseAdmin
    .from('ticket_audit_log')
    .insert({
      ticket_id: null,
      user_id: null,
      action: 'outcome_check_complete',
      details: {
        tickets_checked: totalChecked,
        dismissed: totalDismissed,
        liable: totalLiable,
        disappeared: totalDisappeared,
        pending: totalPending,
        errors: totalErrors,
        plates_looked_up: results.length,
        timestamp: new Date().toISOString(),
      },
      performed_by: 'outcome_checker',
    });

  // Summary
  console.log('\n============================================');
  console.log('  Outcome Check Complete');
  console.log('============================================');
  console.log(`  Tickets checked:  ${totalChecked}`);
  console.log(`  Dismissed (WIN):  ${totalDismissed}`);
  console.log(`  Liable (LOSS):    ${totalLiable}`);
  console.log(`  Disappeared:      ${totalDisappeared}`);
  console.log(`  Still pending:    ${totalPending}`);
  console.log(`  Errors:           ${totalErrors}`);
  console.log('============================================\n');
}

// Run
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
