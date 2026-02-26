/**
 * Cron: Check Contest Outcomes
 *
 * Re-checks the Chicago payment portal API for tickets where we've mailed
 * contest letters. Detects hearing dates, dismissals, and outcomes.
 *
 * Also runs cross-ticket location pattern detection and updates
 * officer intelligence from outcomes.
 *
 * Schedule: Daily (after autopilot-check-plates runs)
 *
 * NOTE: This uses the portal API directly (no Playwright needed) for
 * tickets where we already have the ticket number. The initial plate
 * lookup requires Playwright, but individual ticket status checks
 * can use a simpler HTTP approach via the portal's API.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import {
  detectOutcomeChange,
  processOutcomeChange,
  detectLocationPatterns,
  getOfficerIntelligence,
  OutcomeCheckResult,
} from '../../../lib/contest-outcome-tracker';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const config = {
  maxDuration: 120,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify authorization
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('📊 Starting contest outcome check...');

  const result: OutcomeCheckResult = {
    ticketsChecked: 0,
    outcomesDetected: 0,
    dismissed: 0,
    upheld: 0,
    reduced: 0,
    hearingsScheduled: 0,
    errors: 0,
  };

  try {
    // Fetch tickets that have been mailed (contest letters sent) but no outcome yet
    const { data: trackedTickets, error } = await supabaseAdmin
      .from('detected_tickets')
      .select('id, ticket_number, user_id, violation_type, violation_code, amount, officer_badge, location, plate, state, last_portal_status, last_portal_check')
      .in('status', ['mailed', 'letter_generated', 'hearing_scheduled', 'needs_approval'])
      .not('ticket_number', 'is', null)
      .order('created_at', { ascending: true })
      .limit(30); // Check 30 per run to stay within timeout

    if (error) {
      console.error('Failed to fetch tracked tickets:', error.message);
      return res.status(500).json({ error: error.message });
    }

    if (!trackedTickets || trackedTickets.length === 0) {
      console.log('No tickets to check for outcomes.');

      // Still run location pattern detection
      await runLocationPatternUpdate();

      return res.status(200).json({ message: 'No tickets to check', ...result });
    }

    console.log(`  Checking ${trackedTickets.length} tracked tickets for outcomes...`);

    // For each ticket, check the portal API for status changes
    // We use the Vercel-based API endpoint to check individual tickets
    for (const ticket of trackedTickets) {
      result.ticketsChecked++;

      try {
        // Skip if checked within the last 12 hours
        if (ticket.last_portal_check) {
          const lastCheck = new Date(ticket.last_portal_check).getTime();
          const twelveHoursAgo = Date.now() - 12 * 60 * 60 * 1000;
          if (lastCheck > twelveHoursAgo) {
            continue;
          }
        }

        // Check via the autopilot-check-plates portal API
        // We'll query our own DB for the latest portal data from the scraper
        const { data: latestPortal } = await supabaseAdmin
          .from('portal_check_results')
          .select('ticket_queue, hearing_disposition, current_amount_due, original_amount, checked_at')
          .eq('ticket_number', ticket.ticket_number)
          .order('checked_at', { ascending: false })
          .limit(1)
          .single();

        if (!latestPortal) {
          // No portal data yet — update last_portal_check to avoid rechecking
          await supabaseAdmin
            .from('detected_tickets')
            .update({ last_portal_check: new Date().toISOString() })
            .eq('id', ticket.id);
          continue;
        }

        const change = detectOutcomeChange(ticket, {
          ticket_queue: latestPortal.ticket_queue || '',
          hearing_disposition: latestPortal.hearing_disposition || null,
          current_amount_due: latestPortal.current_amount_due || 0,
          original_amount: latestPortal.original_amount || ticket.amount || 0,
        });

        if (change.outcome) {
          result.outcomesDetected++;
          if (change.outcome === 'dismissed') result.dismissed++;
          else if (change.outcome === 'upheld') result.upheld++;
          else if (change.outcome === 'reduced') result.reduced++;
          else if (change.outcome === 'hearing_scheduled') result.hearingsScheduled++;

          await processOutcomeChange(
            supabaseAdmin,
            ticket,
            change.outcome,
            change.details,
            change.finalAmount,
          );

          // If outcome detected, also check officer intelligence
          if (ticket.officer_badge && (change.outcome === 'dismissed' || change.outcome === 'upheld')) {
            try {
              await updateOfficerStats(ticket.officer_badge, change.outcome);
            } catch { /* non-critical */ }
          }
        } else {
          // No change — just update the check timestamp
          await supabaseAdmin
            .from('detected_tickets')
            .update({ last_portal_check: new Date().toISOString() })
            .eq('id', ticket.id);
        }
      } catch (err: any) {
        console.error(`  Error checking ${ticket.ticket_number}: ${err.message}`);
        result.errors++;
      }

      // Small delay between checks
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Run location pattern detection
    await runLocationPatternUpdate();

  } catch (err: any) {
    console.error('Outcome check failed:', err);
    return res.status(500).json({ error: err.message, ...result });
  }

  console.log('📊 Outcome check complete:', result);
  return res.status(200).json(result);
}

/**
 * Update hearing_officer_patterns with new outcome data.
 */
async function updateOfficerStats(officerBadge: string, outcome: 'dismissed' | 'upheld' | 'reduced'): Promise<void> {
  // Upsert into hearing_officer_patterns
  const { data: existing } = await supabaseAdmin
    .from('hearing_officer_patterns')
    .select('*')
    .eq('officer_id', officerBadge)
    .single();

  if (existing) {
    const totalCases = (existing.total_cases || 0) + 1;
    const totalDismissals = (existing.total_dismissals || 0) + (outcome === 'dismissed' ? 1 : 0);
    const totalUpheld = (existing.total_upheld || 0) + (outcome === 'upheld' ? 1 : 0);

    await supabaseAdmin
      .from('hearing_officer_patterns')
      .update({
        total_cases: totalCases,
        total_dismissals: totalDismissals,
        total_upheld: totalUpheld,
        overall_dismissal_rate: totalCases > 0 ? totalDismissals / totalCases : 0,
        tends_toward: totalDismissals / totalCases > 0.55 ? 'lenient'
          : totalDismissals / totalCases < 0.35 ? 'strict'
          : 'neutral',
        last_updated: new Date().toISOString(),
      })
      .eq('officer_id', officerBadge);
  } else {
    await supabaseAdmin
      .from('hearing_officer_patterns')
      .insert({
        officer_id: officerBadge,
        total_cases: 1,
        total_dismissals: outcome === 'dismissed' ? 1 : 0,
        total_upheld: outcome === 'upheld' ? 1 : 0,
        overall_dismissal_rate: outcome === 'dismissed' ? 1.0 : 0,
        tends_toward: 'neutral',
        last_updated: new Date().toISOString(),
      });
  }
}

/**
 * Detect and store location patterns for use in letter generation.
 */
async function runLocationPatternUpdate(): Promise<void> {
  try {
    const patterns = await detectLocationPatterns(supabaseAdmin, 3);
    const hotspots = patterns.filter(p => p.isHotspot);

    if (hotspots.length > 0) {
      console.log(`  Location patterns: ${hotspots.length} hotspots detected`);
      for (const h of hotspots.slice(0, 5)) {
        console.log(`    ${h.address}: ${h.ticketCount} tickets, ${h.uniqueUsers} users, ${h.officers.length} officers`);
      }

      // Store hotspots for letter generation use
      for (const hotspot of hotspots) {
        try {
          await supabaseAdmin
            .from('ticket_location_patterns')
            .upsert({
              normalized_address: hotspot.normalizedAddress,
              address: hotspot.address,
              ticket_count: hotspot.ticketCount,
              unique_users: hotspot.uniqueUsers,
              violation_types: hotspot.violationTypes,
              officers: hotspot.officers,
              total_amount: hotspot.totalAmount,
              dismissal_rate: hotspot.dismissalRate,
              is_hotspot: hotspot.isHotspot,
              defense_recommendation: hotspot.defenseRecommendation,
              last_updated: new Date().toISOString(),
            }, { onConflict: 'normalized_address' })
            .then(() => {}, () => {}); // Table may not exist yet
        } catch { /* non-critical */ }
      }
    }
  } catch (err) {
    console.error('  Location pattern detection failed:', err);
  }
}
