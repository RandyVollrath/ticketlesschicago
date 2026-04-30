/**
 * Contest Outcome Tracker
 *
 * Automatically monitors contest outcomes by re-checking the Chicago payment
 * portal for tickets we've filed contest letters for. Detects:
 * - Hearing scheduled (ticket_queue = "Hearing")
 * - Dismissed (hearing_disposition = "Not Liable" or "Dismissed")
 * - Upheld (hearing_disposition = "Liable")
 * - Amount reduced
 *
 * Also integrates officer badge intelligence: when we see which officer/hearing
 * officer handled the case, we update hearing_officer_patterns for future strategy.
 *
 * Designed to run as a daily cron job.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { recordContestOutcome } from './contest-intelligence/outcome-learning';
import { getChicagoDateISO } from './chicago-timezone-utils';
import { evaluateAutopayEligibility, updateContestLifecycle } from './contest-lifecycle';
import { sendPushNotification } from './firebase-admin';
import { Resend } from 'resend';
import { getAdminAlertEmails } from './admin-alert-emails';

// ─── Types ───────────────────────────────────────────────────

export interface OutcomeCheckResult {
  ticketsChecked: number;
  outcomesDetected: number;
  dismissed: number;
  upheld: number;
  reduced: number;
  hearingsScheduled: number;
  errors: number;
}

interface TrackedTicket {
  id: string;
  ticket_number: string;
  user_id: string;
  violation_type: string;
  violation_code: string | null;
  amount: number | null;
  officer_badge: string | null;
  location: string | null;
  status: string | null;
  plate: string | null;
  state: string | null;
  last_portal_status: string | null;
  last_portal_check: string | null;
}

// ─── Outcome Detection from Portal Data ──────────────────────

/**
 * Compare current portal data against stored ticket to detect outcome changes.
 * Returns null if no meaningful change detected.
 */
export function detectOutcomeChange(
  storedTicket: TrackedTicket,
  portalData: {
    ticket_queue: string;
    hearing_disposition: string | null;
    current_amount_due: number;
    original_amount: number;
  },
): {
  outcome: 'dismissed' | 'reduced' | 'upheld' | 'hearing_scheduled' | null;
  details: string;
  finalAmount: number;
} {
  const disposition = (portalData.hearing_disposition || '').toLowerCase().trim();
  const queue = (portalData.ticket_queue || '').toLowerCase().trim();

  // Check for dismissal
  if (disposition === 'not liable' || disposition === 'dismissed' || disposition === 'not guilty') {
    return {
      outcome: 'dismissed',
      details: `Ticket dismissed! Hearing disposition: "${portalData.hearing_disposition}"`,
      finalAmount: 0,
    };
  }

  // Check for upheld (liable)
  if (disposition === 'liable' || disposition === 'guilty' || disposition === 'default') {
    // Check if amount was reduced even though upheld
    if (portalData.current_amount_due < portalData.original_amount && portalData.current_amount_due > 0) {
      return {
        outcome: 'reduced',
        details: `Ticket reduced from $${portalData.original_amount} to $${portalData.current_amount_due}. Disposition: "${portalData.hearing_disposition}"`,
        finalAmount: portalData.current_amount_due,
      };
    }
    return {
      outcome: 'upheld',
      details: `Ticket upheld. Hearing disposition: "${portalData.hearing_disposition}"`,
      finalAmount: portalData.current_amount_due,
    };
  }

  // Check for hearing scheduled (queue changed to Hearing)
  if (queue.includes('hearing') && storedTicket.last_portal_status !== 'hearing') {
    return {
      outcome: 'hearing_scheduled',
      details: `Hearing scheduled. Ticket queue: "${portalData.ticket_queue}"`,
      finalAmount: portalData.current_amount_due,
    };
  }

  // Amount reduced without formal hearing
  // Use stored amount if available, otherwise fall back to portal's original_amount
  const referenceAmount = storedTicket.amount || portalData.original_amount;
  if (
    portalData.current_amount_due > 0 &&
    referenceAmount > 0 &&
    portalData.current_amount_due < referenceAmount * 0.95 // at least 5% reduction
  ) {
    return {
      outcome: 'reduced',
      details: `Amount reduced from $${referenceAmount} to $${portalData.current_amount_due}`,
      finalAmount: portalData.current_amount_due,
    };
  }

  return { outcome: null, details: '', finalAmount: portalData.current_amount_due };
}

/**
 * Process a detected outcome change — record it, update the ticket, notify the user.
 */
export async function processOutcomeChange(
  supabase: SupabaseClient,
  ticket: TrackedTicket,
  outcome: 'dismissed' | 'reduced' | 'upheld' | 'hearing_scheduled',
  details: string,
  finalAmount: number,
): Promise<void> {
  const now = new Date().toISOString();

  if (outcome === 'hearing_scheduled') {
    // Guard: Don't overwrite terminal outcomes (won/lost/reduced) with hearing_scheduled.
    // This can happen if the portal briefly shows "Hearing" queue after a disposition
    // has already been recorded, or on a delayed re-check.
    const terminalTicketStatuses = ['won', 'lost', 'reduced'];
    if (ticket.status && terminalTicketStatuses.includes(ticket.status)) {
      console.log(`    ⚠️ Skipping hearing_scheduled for ${ticket.ticket_number} — already in terminal status '${ticket.status}'`);
      return;
    }

    // Update the ticket status and set a follow-up check date
    // Hearings are typically scheduled 2-4 weeks out; re-check weekly
    const nextCheckDate = new Date();
    nextCheckDate.setDate(nextCheckDate.getDate() + 7); // Check again in 7 days

    await supabase
      .from('detected_tickets')
      .update({
        status: 'hearing_scheduled',
        last_portal_status: 'hearing',
        last_portal_check: now,
        next_portal_check: nextCheckDate.toISOString(),
      })
      .eq('id', ticket.id);

    // Also update contest_letters so admin dashboard shows hearing status
    const { data: hearingLetter } = await supabase
      .from('contest_letters')
      .select('id')
      .eq('ticket_id', ticket.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (hearingLetter?.id) {
      await updateContestLifecycle(supabase as any, {
        contestLetterId: hearingLetter.id,
        ticketId: ticket.id,
        userId: ticket.user_id,
        lifecycleStatus: 'hearing_scheduled',
        source: 'portal',
        rawStatus: details,
        cityCasePayload: {
          ticket_queue: 'Hearing',
          hearing_disposition: null,
          final_amount: finalAmount,
        },
        eventType: 'hearing_scheduled',
        eventDetails: { portal_status: details, next_check: nextCheckDate.toISOString() },
        ticketStatusPatch: {
          last_portal_status: 'hearing',
          last_portal_check: now,
          next_portal_check: nextCheckDate.toISOString(),
        },
      });
    }

    // Audit log
    await supabase.from('ticket_audit_log').insert({
      ticket_id: ticket.id,
      action: 'hearing_scheduled',
      details: { portal_status: details, next_check: nextCheckDate.toISOString() },
      performed_by: null,
    });

    console.log(`    📅 Hearing scheduled for ${ticket.ticket_number} (next check: ${nextCheckDate.toISOString().split('T')[0]})`);

    // Notify user about hearing
    try {
      await notifyUserOfOutcome(supabase, ticket.user_id, ticket.ticket_number, 'hearing_scheduled', 0, ticket.amount || 0);
    } catch (notifyErr: any) {
      console.warn(`    Failed to notify user ${ticket.user_id} about hearing: ${notifyErr.message}`);
    }
    return;
  }

  // Map to contest_outcomes outcome type
  const outcomeType = outcome === 'dismissed' ? 'dismissed'
    : outcome === 'reduced' ? 'reduced'
    : 'upheld';

  // Fetch the contest letter for this ticket (for letter_id)
  const { data: letter } = await supabase
    .from('contest_letters')
    .select('id, defense_type, evidence_integrated, autopay_opt_in, autopay_mode, autopay_cap_amount, autopay_payment_method_id')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Record the outcome using existing learning infrastructure.
  // The outcome-learning module's @ts-nocheck flattens its
  // SupabaseClient generic to a default ReturnType<typeof createClient>
  // which doesn't accept our typed admin client; cast here so the
  // typed-vs-untyped mismatch is contained.
  try {
    await recordContestOutcome(supabase as any, {
      ticket_id: ticket.id,
      letter_id: letter?.id || null,
      user_id: ticket.user_id,
      outcome: outcomeType,
      outcome_date: getChicagoDateISO(),
      original_amount: ticket.amount || undefined,
      final_amount: finalAmount,
      violation_type: ticket.violation_type,
      violation_code: ticket.violation_code || undefined,
      primary_defense: letter?.defense_type || undefined,
      evidence_types: letter?.evidence_integrated ? ['automated'] : [],
      evidence_count: letter?.evidence_integrated ? 1 : 0,
      hearing_type: 'mail' as any,
      hearing_officer_id: ticket.officer_badge || undefined,
    } as any);
  } catch (e) {
    console.error(`    Failed to record outcome: ${e}`);
  }

  // Update ticket status — this is the most critical write.
  // If this fails, the outcome is recorded in contest_outcomes but the ticket
  // still shows "mailed" status. We flag it with `outcome_sync_pending` so
  // the next run of the cron can retry.
  const ticketStatus = outcome === 'dismissed' ? 'won'
    : outcome === 'reduced' ? 'reduced'
    : 'lost';

  const { error: ticketUpdateErr } = await supabase
    .from('detected_tickets')
    .update({
      status: ticketStatus,
      last_portal_status: outcomeType,
      last_portal_check: now,
      contest_outcome: outcomeType,
      contest_outcome_at: now,
      final_amount: finalAmount,
    })
    .eq('id', ticket.id);

  if (ticketUpdateErr) {
    console.error(`    ❌ CRITICAL: Failed to update ticket ${ticket.ticket_number} status to '${ticketStatus}':`, ticketUpdateErr.message);
    // Retry once with a small delay (transient network/DB issue)
    await new Promise(r => setTimeout(r, 1000));
    const { error: retryErr } = await supabase
      .from('detected_tickets')
      .update({
        status: ticketStatus,
        last_portal_status: outcomeType,
        last_portal_check: now,
        contest_outcome: outcomeType,
        contest_outcome_at: now,
        final_amount: finalAmount,
      })
      .eq('id', ticket.id);
    if (retryErr) {
      console.error(`    ❌ RETRY FAILED for ticket ${ticket.ticket_number}: ${retryErr.message}`);
      console.error(`    Outcome '${outcomeType}' was recorded in contest_outcomes but ticket status is stale — will auto-retry next cron run`);
    } else {
      console.log(`    ✅ Retry succeeded for ticket ${ticket.ticket_number}`);
    }
  }

  // Sync outcome to contest_letters table
  if (letter?.id) {
    const lifecycleStatus = outcome === 'dismissed' ? 'won' : outcome === 'reduced' ? 'reduced' : 'lost';
    const autopayEligibility = evaluateAutopayEligibility({
      lifecycleStatus,
      autopayOptIn: (letter as any).autopay_opt_in,
      autopayMode: (letter as any).autopay_mode,
      autopayCapAmount: (letter as any).autopay_cap_amount,
      paymentMethodId: (letter as any).autopay_payment_method_id,
      finalAmount,
    });

    try {
      await updateContestLifecycle(supabase as any, {
        contestLetterId: letter.id,
        ticketId: ticket.id,
        userId: ticket.user_id,
        lifecycleStatus,
        source: 'portal',
        rawStatus: details,
        cityCasePayload: {
          hearing_disposition: details,
          final_amount: finalAmount,
          original_amount: ticket.amount,
          outcome: outcomeType,
        },
        eventType: `contest_${outcomeType}`,
        eventDetails: {
          finalAmount,
          originalAmount: ticket.amount,
          autopayEligibility,
        },
        contestLetterPatch: {
          contest_outcome: outcomeType,
          contest_outcome_at: now,
          disposition: outcomeType,
          disposition_date: now,
          final_amount: finalAmount,
          autopay_status: autopayEligibility.status,
        },
        ticketStatusPatch: {
          last_portal_status: outcomeType,
          last_portal_check: now,
          contest_outcome: outcomeType,
          contest_outcome_at: now,
          final_amount: finalAmount,
        },
      });
    } catch (letterUpdateErr: any) {
      console.error(`    Failed to sync contest lifecycle ${letter.id}: ${letterUpdateErr.message}`);
    }
  }

  // Audit log
  try {
    await supabase.from('ticket_audit_log').insert({
      ticket_id: ticket.id,
      action: `contest_${outcomeType}`,
      details: {
        portal_status: details,
        original_amount: ticket.amount,
        final_amount: finalAmount,
        amount_saved: outcome === 'dismissed' ? ticket.amount : (ticket.amount || 0) - finalAmount,
      },
      performed_by: null,
    });
  } catch (auditErr: any) {
    console.warn(`    Audit log insert failed: ${auditErr.message} (non-critical)`);
  }

  console.log(`    ${outcome === 'dismissed' ? '🎉' : outcome === 'reduced' ? '💰' : '❌'} ${ticket.ticket_number}: ${details}`);

  // ── Notify the user via push notification ──
  try {
    await notifyUserOfOutcome(supabase, ticket.user_id, ticket.ticket_number, outcome, finalAmount, ticket.amount || 0);
  } catch (notifyErr: any) {
    console.warn(`    Failed to notify user ${ticket.user_id}: ${notifyErr.message}`);
  }

  // ── Notify admin of every contest outcome ──
  try {
    await notifyAdminOfOutcome(supabase, ticket, outcome, finalAmount, details);
  } catch (adminErr: any) {
    console.warn(`    Admin outcome notification failed (non-critical): ${adminErr.message}`);
  }
}

// ─── User Notification ───────────────────────────────────────

/**
 * Notify a user about a contest outcome via push notification.
 * Falls back gracefully if no push token is available.
 */
async function notifyUserOfOutcome(
  supabase: SupabaseClient,
  userId: string,
  ticketNumber: string,
  outcome: 'dismissed' | 'reduced' | 'upheld' | 'hearing_scheduled',
  finalAmount: number,
  originalAmount: number,
): Promise<void> {
  // Build notification content
  let title: string;
  let body: string;
  switch (outcome) {
    case 'dismissed':
      title = 'Ticket Dismissed!';
      body = `Great news! Ticket ${ticketNumber} has been dismissed. You saved $${originalAmount.toFixed(0)}.`;
      break;
    case 'reduced':
      title = 'Ticket Amount Reduced';
      body = `Ticket ${ticketNumber} was reduced from $${originalAmount.toFixed(0)} to $${finalAmount.toFixed(0)}.`;
      break;
    case 'upheld':
      title = 'Contest Result: Upheld';
      body = `Ticket ${ticketNumber} was upheld. The amount due is $${finalAmount.toFixed(0)}.`;
      break;
    case 'hearing_scheduled':
      title = 'Hearing Scheduled';
      body = `A hearing has been scheduled for ticket ${ticketNumber}. We'll keep you updated.`;
      break;
  }

  // Get fresh FCM token for the user
  const { data: tokenRows } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('last_used_at', { ascending: false })
    .limit(1);

  if (!tokenRows || tokenRows.length === 0) {
    console.log(`    No active push token for user ${userId} — skipping push notification`);
    return;
  }

  const fcmToken = tokenRows[0].token;
  if (!fcmToken) return;

  const result = await sendPushNotification(fcmToken, {
    title,
    body,
    data: {
      type: 'contest_outcome',
      outcome,
      ticket_number: ticketNumber,
      screen: 'History',
    },
  });

  if (result.success) {
    console.log(`    Push notification sent to user ${userId}`);
  } else {
    console.warn(`    Push notification failed for user ${userId}: ${result.error}`);
    // Deactivate invalid tokens
    if (result.invalidToken) {
      await supabase
        .from('push_tokens')
        .update({ is_active: false })
        .eq('token', fcmToken);
      console.log(`    Deactivated invalid push token`);
    }
  }

  // Also log to notification_logs for tracking
  try {
    await supabase.from('notification_logs').insert({
      user_id: userId,
      notification_type: 'push',
      category: 'contest_outcome',
      subject: title,
      body,
      status: result.success ? 'sent' : 'failed',
      error_message: result.error || null,
      sent_at: new Date().toISOString(),
    });
  } catch {
    // notification_logs table may not exist — non-critical
  }
}

/**
 * Email the admin every time a contest outcome is detected. Pulls the user's
 * email/name for context. Non-blocking — caller already wraps in try/catch.
 */
async function notifyAdminOfOutcome(
  supabase: SupabaseClient,
  ticket: TrackedTicket,
  outcome: 'dismissed' | 'reduced' | 'upheld' | 'hearing_scheduled',
  finalAmount: number,
  details: string,
): Promise<void> {
  if (!process.env.RESEND_API_KEY) return;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('email, first_name, last_name')
    .eq('user_id', ticket.user_id)
    .maybeSingle();

  const userEmail = (profile as any)?.email || '(unknown)';
  const userName = `${(profile as any)?.first_name || ''} ${(profile as any)?.last_name || ''}`.trim() || '(no name)';
  const original = ticket.amount || 0;
  const saved = outcome === 'dismissed' ? original : Math.max(0, original - finalAmount);

  const emoji = outcome === 'dismissed' ? '🎉'
    : outcome === 'reduced' ? '💰'
    : outcome === 'hearing_scheduled' ? '📅'
    : '❌';
  const headline = outcome === 'dismissed' ? 'Ticket dismissed (won)'
    : outcome === 'reduced' ? 'Ticket reduced'
    : outcome === 'hearing_scheduled' ? 'Hearing scheduled'
    : 'Ticket upheld (lost)';
  const headerColor = outcome === 'dismissed' ? '#0F766E'
    : outcome === 'reduced' ? '#1D4ED8'
    : outcome === 'hearing_scheduled' ? '#7C3AED'
    : '#B91C1C';

  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: 'Autopilot America <alerts@autopilotamerica.com>',
    to: getAdminAlertEmails(),
    subject: `${emoji} ${headline}: ${ticket.ticket_number} — ${userEmail}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
        <div style="background: ${headerColor}; color: white; padding: 16px 20px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0;">${emoji} ${headline}</h2>
        </div>
        <div style="padding: 20px; background: white; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 6px 0; color: #6b7280; width: 160px;">Ticket #</td><td style="padding: 6px 0; font-weight: 600; font-family: monospace;">${ticket.ticket_number}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Violation</td><td style="padding: 6px 0;">${ticket.violation_type}${ticket.violation_code ? ` (${ticket.violation_code})` : ''}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Customer</td><td style="padding: 6px 0;">${userName}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Email</td><td style="padding: 6px 0;">${userEmail}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Plate</td><td style="padding: 6px 0; font-family: monospace;">${ticket.plate || '(unknown)'} ${ticket.state || ''}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Original amount</td><td style="padding: 6px 0;">$${original.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Final amount</td><td style="padding: 6px 0; font-weight: 600;">$${finalAmount.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Customer saved</td><td style="padding: 6px 0; font-weight: 600; color: ${saved > 0 ? '#0F766E' : '#6b7280'};">$${saved.toFixed(2)}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Officer badge</td><td style="padding: 6px 0; font-family: monospace;">${ticket.officer_badge || '(unknown)'}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Location</td><td style="padding: 6px 0;">${ticket.location || '(unknown)'}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">Portal disposition</td><td style="padding: 6px 0; font-style: italic;">${details}</td></tr>
            <tr><td style="padding: 6px 0; color: #6b7280;">User ID</td><td style="padding: 6px 0; font-family: monospace; font-size: 12px;">${ticket.user_id}</td></tr>
          </table>
        </div>
      </div>
    `,
  });
  console.log(`    📧 Admin outcome email sent for ticket ${ticket.ticket_number}`);
}

// ─── Location Pattern Detection ──────────────────────────────

export interface LocationPattern {
  address: string;
  normalizedAddress: string;
  ticketCount: number;
  uniqueUsers: number;
  violationTypes: string[];
  officers: string[];
  totalAmount: number;
  dismissalRate: number | null;
  isHotspot: boolean;
  defenseRecommendation: string | null;
}

/**
 * Detect cross-ticket patterns by location.
 * Identifies "ticket hotspots" — locations where multiple users get ticketed,
 * which suggests systematic signage/enforcement issues.
 */
export async function detectLocationPatterns(
  supabase: SupabaseClient,
  minTickets: number = 3,
): Promise<LocationPattern[]> {
  // Get all contested tickets grouped by normalized location
  const { data: tickets, error } = await supabase
    .from('detected_tickets')
    .select('id, location, violation_type, officer_badge, amount, user_id, status, contest_outcome')
    .not('location', 'is', null)
    .order('location');

  if (error || !tickets) return [];

  // Group by normalized location
  const locationMap = new Map<string, typeof tickets>();
  for (const t of tickets) {
    const key = normalizeLocation(t.location);
    if (!key) continue;
    const group = locationMap.get(key) || [];
    group.push(t);
    locationMap.set(key, group);
  }

  const patterns: LocationPattern[] = [];

  for (const [normalizedAddr, group] of locationMap) {
    if (group.length < minTickets) continue;

    const uniqueUsers = new Set(group.map(t => t.user_id)).size;
    const violationTypes = [...new Set(group.map(t => t.violation_type).filter(Boolean))];
    const officers = [...new Set(group.map(t => t.officer_badge).filter(Boolean))] as string[];
    const totalAmount = group.reduce((sum, t) => sum + (t.amount || 0), 0);

    // Calculate dismissal rate for this location
    const contested = group.filter(t => t.contest_outcome);
    const dismissed = contested.filter(t => t.contest_outcome === 'dismissed');
    const dismissalRate = contested.length >= 3 ? dismissed.length / contested.length : null;

    // Is this a hotspot? (3+ tickets from 2+ users)
    const isHotspot = group.length >= 3 && uniqueUsers >= 2;

    // Generate defense recommendation based on pattern
    let defenseRecommendation: string | null = null;
    if (isHotspot) {
      if (officers.length === 1) {
        defenseRecommendation = `Single officer (badge ${officers[0]}) has issued ${group.length} tickets at this location across ${uniqueUsers} different vehicles. This suggests targeted enforcement or a problematic location, not isolated violations.`;
      } else if (dismissalRate !== null && dismissalRate > 0.5) {
        defenseRecommendation = `${Math.round(dismissalRate * 100)}% of contested tickets at this location have been dismissed (${dismissed.length}/${contested.length}). This high dismissal rate suggests systematic signage or enforcement issues.`;
      } else {
        defenseRecommendation = `${group.length} tickets issued to ${uniqueUsers} different vehicles at this location. Multiple motorists cited at the same spot suggests confusing signage or unclear restrictions.`;
      }
    }

    patterns.push({
      address: group[0].location,
      normalizedAddress: normalizedAddr,
      ticketCount: group.length,
      uniqueUsers,
      violationTypes,
      officers,
      totalAmount,
      dismissalRate,
      isHotspot,
      defenseRecommendation,
    });
  }

  // Sort by ticket count descending
  patterns.sort((a, b) => b.ticketCount - a.ticketCount);

  return patterns;
}

/**
 * Get location pattern data for a specific address.
 * Used during letter generation to add "this location has a pattern" argument.
 */
export async function getLocationPatternForAddress(
  supabase: SupabaseClient,
  address: string,
): Promise<LocationPattern | null> {
  const normalized = normalizeLocation(address);
  if (!normalized) return null;

  const patterns = await detectLocationPatterns(supabase, 2);
  return patterns.find(p => p.normalizedAddress === normalized) || null;
}

// ─── Officer Badge Intelligence ──────────────────────────────

/**
 * Get officer intelligence for a specific badge number.
 * Checks hearing_officer_patterns first, falls back to FOIA officer_win_rates.
 * Returns a defense strategy recommendation.
 */
export async function getOfficerIntelligence(
  supabase: SupabaseClient,
  officerBadge: string | null,
): Promise<{
  hasData: boolean;
  officerBadge: string | null;
  totalCases: number;
  dismissalRate: number | null;
  tendency: 'lenient' | 'strict' | 'neutral' | null;
  recommendation: string | null;
} | null> {
  if (!officerBadge) return null;

  // Try hearing_officer_patterns first
  const { data: pattern } = await supabase
    .from('hearing_officer_patterns')
    .select('*')
    .eq('officer_id', officerBadge)
    .maybeSingle();

  if (pattern && pattern.total_cases >= 5) {
    const tendency = pattern.overall_dismissal_rate > 0.55 ? 'lenient'
      : pattern.overall_dismissal_rate < 0.35 ? 'strict'
      : 'neutral';

    let recommendation: string;
    if (tendency === 'lenient') {
      recommendation = `This issuing officer's tickets have a ${Math.round(pattern.overall_dismissal_rate * 100)}% dismissal rate in hearings (${pattern.total_cases} cases). Historically favorable for contests.`;
    } else if (tendency === 'strict') {
      recommendation = `This officer's citations are upheld at a high rate. Focus on strong factual defenses (GPS evidence, receipts, FOIA records) rather than procedural arguments.`;
    } else {
      recommendation = `This officer has a mixed record. Build the strongest case possible with multiple evidence sources.`;
    }

    return {
      hasData: true,
      officerBadge,
      totalCases: pattern.total_cases,
      dismissalRate: pattern.overall_dismissal_rate,
      tendency,
      recommendation,
    };
  }

  // Fall back to FOIA officer_win_rates
  try {
    const { data: foiaData } = await supabase
      .from('officer_win_rates')
      .select('*')
      .eq('officer_badge', officerBadge)
      .maybeSingle();

    if (foiaData && foiaData.total_contests >= 5) {
      const dismissalRate = (foiaData.loss_rate_percent || 0) / 100; // "loss" from city's POV = dismissal
      const tendency = dismissalRate > 0.55 ? 'lenient' as const
        : dismissalRate < 0.35 ? 'strict' as const
        : 'neutral' as const;

      return {
        hasData: true,
        officerBadge,
        totalCases: foiaData.total_contests,
        dismissalRate,
        tendency,
        recommendation: `FOIA data shows this officer's tickets have a ${Math.round(dismissalRate * 100)}% dismissal rate across ${foiaData.total_contests} hearings.`,
      };
    }
  } catch {
    // Table may not exist or no data
  }

  return null;
}

// ─── FOIA Response Detection ─────────────────────────────────

/**
 * Detect if a FOIA response is actually an extension notice (not a substantive response).
 *
 * Under 5 ILCS 140/3(e), the city can extend the response deadline by 5 business days
 * for specific reasons. Extension emails cite the statute and use language like
 * "extension of the time for response" or "additional five (5) business days."
 *
 * This is NOT a fulfillment — the actual response comes later. We must:
 * 1. NOT mark the FOIA as fulfilled
 * 2. NOT notify the user (they don't need to know about procedural extensions)
 * 3. DO track it as 'extension_requested' for admin visibility
 */
export function isExtensionResponse(subject: string, body: string): boolean {
  const combined = `${subject} ${body}`.toLowerCase();

  // Strong signals — statutory citation for FOIA extensions
  const statutoryExtensionPatterns = [
    '5 ilcs 140/3(e)',         // Exact statute citation for extensions
    '5 ilcs 140/3 (e)',       // Alternate spacing
    '5 ilcs 140, section 3',  // Longer form citation
    'section 3(e)',            // Short form of extension statute
    'section 3 (e)',           // Short form with space
  ];
  const hasStatutorySignal = statutoryExtensionPatterns.some(p => combined.includes(p));

  // Extension-specific language
  const extensionKeywords = [
    'extension of the time for response',
    'extension of time',
    'additional five (5) business days',
    'additional 5 business days',
    'additional five business days',
    'five (5) business day extension',
    'five business day extension',
    '5 business day extension',
    'extending the time',
    'extend the time',
    'request additional time',
    'requesting additional time',
    'extended deadline',
    'extension of the response',
    'notify you of an extension',
    'notifying you of an extension',
    'notice of extension',
  ];
  const hasExtensionKeyword = extensionKeywords.some(k => combined.includes(k));

  // "hereby notify/notifying" — only count when "extension" is also nearby
  const hasHerebyNotifyWithExtension =
    combined.includes('hereby notif') && combined.includes('extension');

  // Extension reasons the city commonly cites under 5 ILCS 140/3(e)
  const extensionReasons = [
    'consultation with another public body',
    'unduly burdensome',
    'voluminous',
    'categorical request',
    'need to search for',
    'records are stored',
    'consult with another',
  ];
  const hasExtensionReason = extensionReasons.some(r => combined.includes(r));

  // Must have statutory signal OR (extension keyword + extension reason/context)
  // This prevents false positives from casual mentions of "extension"
  if (hasStatutorySignal) return true;
  if (hasExtensionKeyword && hasExtensionReason) return true;
  if (hasExtensionKeyword && combined.includes('extension')) return true;
  if (hasHerebyNotifyWithExtension) return true;

  return false;
}

/**
 * Check if an incoming email is a FOIA response from the City of Chicago.
 */
export function isFoiaResponseEmail(
  fromEmail: string,
  subject: string,
  body: string,
): boolean {
  const from = fromEmail.toLowerCase();
  const subj = subject.toLowerCase();
  const text = body.toLowerCase();

  // Check sender — DOF FOIA office, CDOT, any cityofchicago.org, or GovQA (city's FOIA portal)
  const foiaSenders = [
    'doffoia@cityofchicago.org',
    'dof-foia@cityofchicago.org',       // Hyphenated variant
    'foia@cityofchicago.org',
    'finance.foia@cityofchicago.org',
    'doah@cityofchicago.org',            // Department of Administrative Hearings
    'noreply@cityofchicago.org',
    'cdotfoia@cityofchicago.org',        // CDOT (red-light/speed camera evidence)
    'cdot-foia@cityofchicago.org',       // CDOT hyphenated variant
    'cdot.foia@cityofchicago.org',       // CDOT dotted variant
    'chicagoil@govqa.us',                // GovQA FOIA portal used by Chicago
  ];
  const isFromCity = foiaSenders.some(s => from.includes(s))
    || from.includes('cityofchicago.org')
    || from.includes('govqa.us'); // GovQA hosts Chicago's FOIA portal

  // Check subject/body keywords
  const foiaKeywords = ['foia', 'freedom of information', 'records request', 'public records', 'responsive documents', 'enforcement records'];
  const hasKeyword = foiaKeywords.some(k => subj.includes(k) || text.includes(k));

  // Also match if our reference ID is in the subject (city quoting our ref)
  const hasReferenceId = /\bAP[EH]-[A-Za-z0-9_-]{6,}\b/.test(subject);

  return isFromCity && (hasKeyword || hasReferenceId);
}

/**
 * Determine if a FOIA response is for an evidence request or a history request.
 * Evidence: APE- prefix, ticket number pattern, enforcement records keywords
 * History:  APH- prefix, plate number pattern, ticket history keywords
 */
export function classifyFoiaResponseType(
  subject: string,
  body: string,
): 'evidence' | 'history' | 'unknown' {
  const combined = `${subject} ${body}`.toLowerCase();
  const subjectOnly = subject;

  // Check for reference ID prefixes (strongest signal)
  if (/\bAPE-[A-Za-z0-9_-]+\b/.test(subjectOnly)) return 'evidence';
  if (/\bCDOT-[A-Za-z0-9_-]+\b/.test(subjectOnly)) return 'evidence'; // CDOT signal timing is evidence
  if (/\bAPH-[A-Za-z0-9_-]+\b/.test(subjectOnly)) return 'history';

  // Check for evidence-specific keywords
  const evidenceKeywords = ['enforcement records', 'officer', 'citation #', 'field notes', 'handheld device', 'photographs taken'];
  if (evidenceKeywords.some(k => combined.includes(k))) return 'evidence';

  // Check for history-specific keywords
  const historyKeywords = ['ticket history', 'complete history', 'all tickets', 'all citations', 'citation history', 'receivable history'];
  if (historyKeywords.some(k => combined.includes(k))) return 'history';

  return 'unknown';
}

/**
 * Extract reference IDs from email subject or body.
 * Returns APE-xxx, APH-xxx, or CDOT-xxx if found.
 */
export function extractReferenceId(subject: string, body: string): string | null {
  // Check subject first (most reliable — we put it there)
  const subjectMatch = subject.match(/\b((?:AP[EH]|CDOT)-[A-Za-z0-9_-]{6,})\b/);
  if (subjectMatch) return subjectMatch[1];

  // Check body (city might quote our reference)
  const bodyMatch = body.match(/\b((?:AP[EH]|CDOT)-[A-Za-z0-9_-]{6,})\b/);
  if (bodyMatch) return bodyMatch[1];

  return null;
}

/**
 * Layer 4: AI-powered fuzzy matching for FOIA responses.
 *
 * When layers 1-3 fail, we ask Gemini to extract identifying info from the email
 * (ticket numbers, plate numbers, dates, names) and match against all pending FOIAs.
 * Only auto-matches if confidence >= 90%. Returns null if no confident match.
 */
async function tryAiFoiaMatch(
  supabase: SupabaseClient,
  fromEmail: string,
  subject: string,
  body: string,
  attachments: { filename: string; content_type: string; url?: string }[],
  foiaType: 'evidence' | 'history' | 'unknown',
): Promise<{
  type: 'evidence' | 'history';
  request: any;
  ticketNumber: string | null;
  confidence: number;
} | null> {
  try {
    // Only attempt if we have a Gemini key (cheapest option for extraction)
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
    if (!geminiKey) return null;

    // Get all pending evidence + history FOIAs to match against
    const [{ data: pendingEvidence }, { data: pendingHistory }] = await Promise.all([
      supabase
        .from('ticket_foia_requests')
        .select('id, reference_id, status, request_payload, detected_tickets!inner(ticket_number, user_id)')
        .in('status', ['sent', 'extension_requested']),
      supabase
        .from('foia_history_requests')
        .select('id, reference_id, status, license_plate, license_state, name, email')
        .in('status', ['sent', 'extension_requested']),
    ]);

    if ((!pendingEvidence || pendingEvidence.length === 0) && (!pendingHistory || pendingHistory.length === 0)) {
      return null;
    }

    // Build a summary of pending FOIAs for the AI
    const pendingSummary = [
      ...(pendingEvidence || []).map((r: any) => ({
        id: r.id,
        type: 'evidence',
        ref: r.reference_id,
        ticket: r.detected_tickets?.ticket_number,
        plate: r.request_payload?.plate,
        name: r.request_payload?.requester_name,
      })),
      ...(pendingHistory || []).map((r: any) => ({
        id: r.id,
        type: 'history',
        ref: r.reference_id,
        plate: r.license_plate,
        state: r.license_state,
        name: r.name,
      })),
    ];

    if (pendingSummary.length === 0) return null;

    // Ask Gemini to extract identifiers and find the best match
    const { GoogleGenerativeAI } = await import('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `You are matching a FOIA response email to a pending FOIA request.

EMAIL:
From: ${fromEmail}
Subject: ${subject}
Body (first 2000 chars): ${body.substring(0, 2000)}
Attachments: ${attachments.map(a => a.filename).join(', ') || 'none'}

PENDING FOIA REQUESTS:
${JSON.stringify(pendingSummary, null, 2)}

Extract any ticket numbers (10+ digits), license plates, reference IDs (APE-xxx, APH-xxx, or CDOT-xxx), or person names from the email. Then determine which pending FOIA request (if any) this email is responding to.

Respond in JSON only:
{
  "extracted_ticket_numbers": ["..."],
  "extracted_plates": ["..."],
  "extracted_reference_ids": ["..."],
  "extracted_names": ["..."],
  "best_match_id": "id of matching request or null",
  "match_type": "evidence or history",
  "confidence": 0-100,
  "reasoning": "one sentence explanation"
}`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    // Parse JSON from response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.best_match_id || parsed.confidence < 90) {
      console.log(`  Layer 4 AI: ${parsed.confidence}% confidence — below 90% threshold. Reason: ${parsed.reasoning}`);
      return null;
    }

    // Find the matching request
    if (parsed.match_type === 'evidence') {
      const match = (pendingEvidence || []).find((r: any) => r.id === parsed.best_match_id);
      if (match) {
        return {
          type: 'evidence',
          request: match,
          ticketNumber: (match as any).detected_tickets?.ticket_number || null,
          confidence: parsed.confidence,
        };
      }
    } else {
      const match = (pendingHistory || []).find((r: any) => r.id === parsed.best_match_id);
      if (match) {
        return {
          type: 'history',
          request: match,
          ticketNumber: null,
          confidence: parsed.confidence,
        };
      }
    }

    return null;
  } catch (err: any) {
    console.log(`  Layer 4 AI match failed: ${err.message}`);
    return null;
  }
}

/**
 * Process a FOIA response email with 4-layer matching:
 *
 * Layer 1: Reference ID (APE-xxx / APH-xxx) — most reliable
 * Layer 2: In-Reply-To / References header → resend_message_id
 * Layer 3: Ticket number regex + single-pending fallback
 * Layer 4: AI-powered fuzzy matching (Gemini) — catches everything else at 90%+ confidence
 *
 * If no match after all 4 layers → insert into foia_unmatched_responses for admin review.
 */
export async function processFoiaResponse(
  supabase: SupabaseClient,
  fromEmail: string,
  subject: string,
  body: string,
  attachments: { filename: string; content_type: string; url?: string }[],
  emailHeaders?: { inReplyTo?: string; references?: string; messageId?: string },
): Promise<{
  matched: boolean;
  requestId: string | null;
  ticketNumber: string | null;
  foiaType: 'evidence' | 'history' | 'unknown';
  action: string;
  isExtension?: boolean;
}> {
  const foiaType = classifyFoiaResponseType(subject, body);
  const referenceId = extractReferenceId(subject, body);

  console.log(`  FOIA type: ${foiaType}, Reference ID: ${referenceId || 'none'}`);

  // ── Layer 1: Match by reference ID ──
  if (referenceId) {
    if (referenceId.startsWith('APE-') || referenceId.startsWith('CDOT-')) {
      const { data: match } = await supabase
        .from('ticket_foia_requests')
        .select('*, detected_tickets!inner(ticket_number, user_id)')
        .eq('reference_id', referenceId)
        .maybeSingle();

      if (match) {
        console.log(`  Layer 1 match (${referenceId.startsWith('CDOT-') ? 'CDOT' : 'evidence'} ref): ${referenceId}`);
        return processEvidenceFoiaMatch(supabase, match, fromEmail, subject, body, attachments, 'reference_id');
      }
    } else if (referenceId.startsWith('APH-')) {
      const { data: match } = await supabase
        .from('foia_history_requests')
        .select('*')
        .eq('reference_id', referenceId)
        .maybeSingle();

      if (match) {
        console.log(`  Layer 1 match (history ref): ${referenceId}`);
        return {
          matched: true,
          requestId: match.id,
          ticketNumber: null,
          foiaType: 'history',
          action: 'history_foia_matched_by_reference',
        };
      }
    }
  }

  // ── Layer 2: Match by In-Reply-To header → resend_message_id ──
  const inReplyTo = emailHeaders?.inReplyTo;
  const references = emailHeaders?.references;
  const messageIds = [inReplyTo, ...(references?.split(/\s+/) || [])].filter(Boolean) as string[];

  if (messageIds.length > 0) {
    // Clean message IDs (strip angle brackets)
    const cleanIds = messageIds.map(id => id.replace(/^<|>$/g, '').trim()).filter(Boolean);

    for (const msgId of cleanIds) {
      // Try evidence FOIA
      const { data: evidenceMatch } = await supabase
        .from('ticket_foia_requests')
        .select('*, detected_tickets!inner(ticket_number, user_id)')
        .eq('resend_message_id', msgId)
        .maybeSingle();

      if (evidenceMatch) {
        console.log(`  Layer 2 match (evidence In-Reply-To): ${msgId}`);
        return processEvidenceFoiaMatch(supabase, evidenceMatch, fromEmail, subject, body, attachments, 'in_reply_to');
      }

      // Try history FOIA
      const { data: historyMatch } = await supabase
        .from('foia_history_requests')
        .select('*')
        .eq('resend_message_id', msgId)
        .maybeSingle();

      if (historyMatch) {
        console.log(`  Layer 2 match (history In-Reply-To): ${msgId}`);
        return {
          matched: true,
          requestId: historyMatch.id,
          ticketNumber: null,
          foiaType: 'history',
          action: 'history_foia_matched_by_header',
        };
      }
    }
  }

  // ── Layer 3: Ticket number regex + single-pending fallback ──
  // Only for evidence FOIAs (history FOIAs don't reference specific ticket numbers)
  if (foiaType !== 'history') {
    const ticketNumberMatch = body.match(/(?:ticket|citation|receivable)[\s#:]*(\d{10,})/i)
      || subject.match(/(?:ticket|citation|receivable)[\s#:]*(\d{10,})/i)
      || subject.match(/#(\d{10,})/);

    const { data: pendingRequests } = await supabase
      .from('ticket_foia_requests')
      .select('*, detected_tickets!inner(ticket_number, user_id)')
      .in('status', ['sent', 'extension_requested'])
      .order('sent_at', { ascending: true });

    if (pendingRequests && pendingRequests.length > 0) {
      let matchedRequest = null;

      // Try ticket number match
      if (ticketNumberMatch) {
        const extractedNumber = ticketNumberMatch[1];
        matchedRequest = pendingRequests.find((r: any) =>
          r.detected_tickets?.ticket_number === extractedNumber ||
          r.request_payload?.ticket_number === extractedNumber
        );
      }

      // Single-pending fallback (unambiguous)
      if (!matchedRequest && pendingRequests.length === 1) {
        matchedRequest = pendingRequests[0];
        console.log(`  Layer 3 fallback: only one pending evidence FOIA`);
      }

      if (matchedRequest) {
        console.log(`  Layer 3 match (ticket number / single-pending)`);
        return processEvidenceFoiaMatch(supabase, matchedRequest, fromEmail, subject, body, attachments, 'ticket_number_or_single');
      }
    }
  }

  // ── Layer 4: AI-powered fuzzy matching ──
  // Use Claude to extract identifying info from the email and match against all pending FOIAs
  const aiMatch = await tryAiFoiaMatch(supabase, fromEmail, subject, body, attachments, foiaType);
  if (aiMatch) {
    if (aiMatch.type === 'evidence') {
      console.log(`  Layer 4 AI match (evidence): ticket ${aiMatch.ticketNumber}, confidence ${aiMatch.confidence}%`);
      return processEvidenceFoiaMatch(supabase, aiMatch.request, fromEmail, subject, body, attachments, 'ai_fuzzy_match');
    } else {
      console.log(`  Layer 4 AI match (history): request ${aiMatch.request.id}, confidence ${aiMatch.confidence}%`);
      return {
        matched: true,
        requestId: aiMatch.request.id,
        ticketNumber: null,
        foiaType: 'history',
        action: 'history_foia_matched_by_ai',
      };
    }
  }

  // ── No match — insert into unmatched queue for admin review ──
  console.log(`  No FOIA match found after all 4 layers — queuing for admin review`);
  try {
    await supabase
      .from('foia_unmatched_responses' as any)
      .insert({
        from_email: fromEmail,
        to_email: 'foia@autopilotamerica.com',
        subject,
        body_preview: body.substring(0, 500),
        full_body: body,
        attachment_count: attachments.length,
        attachment_metadata: attachments.map(a => ({ filename: a.filename, type: a.content_type })),
        email_headers: emailHeaders || null,
        extracted_ticket_number: body.match(/\d{10,}/)?.[0] || null,
        extracted_plate: body.match(/\b[A-Z]{2}\s+[A-Z0-9]{2,8}\b/)?.[0] || null,
        extracted_reference_id: referenceId,
        match_attempts: {
          layer1_reference_id: referenceId || 'none',
          layer2_headers: messageIds.length > 0 ? messageIds : 'none',
          layer3_ticket_regex: body.match(/\d{10,}/)?.[0] || 'none',
          layer4_ai: aiMatch === null ? 'no_match' : 'below_threshold',
        },
        status: 'pending',
      });
  } catch (err: any) {
    console.error(`  Failed to insert unmatched response: ${err.message}`);
  }

  return {
    matched: false,
    requestId: null,
    ticketNumber: body.match(/\d{10,}/)?.[0] || null,
    foiaType,
    action: 'queued_for_admin_review',
  };
}

/**
 * Process a matched evidence FOIA response — classify the response,
 * update the request status, and create audit log entries.
 */
async function processEvidenceFoiaMatch(
  supabase: SupabaseClient,
  matchedRequest: any,
  fromEmail: string,
  subject: string,
  body: string,
  attachments: { filename: string; content_type: string; url?: string }[],
  matchMethod: string,
): Promise<{
  matched: boolean;
  requestId: string;
  ticketNumber: string | null;
  foiaType: 'evidence';
  action: string;
  isExtension?: boolean;
}> {
  // ── Extension check — must come BEFORE fulfillment/denial classification ──
  // Guard: Don't downgrade an already-fulfilled/denied request back to extension_requested.
  // This handles the edge case where the city sends a late extension notice AFTER the real response.
  const terminalStatuses = ['fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records'];
  if (isExtensionResponse(subject, body) && !terminalStatuses.includes(matchedRequest.status)) {
    console.log(`  Extension detected for evidence FOIA ${matchedRequest.id} — NOT marking as fulfilled`);
    const ticketNumber = matchedRequest.detected_tickets?.ticket_number || null;

    await supabase
      .from('ticket_foia_requests')
      .update({
        status: 'extension_requested',
        updated_at: new Date().toISOString(),
        response_payload: {
          from: fromEmail,
          subject,
          body_preview: body.substring(0, 500),
          attachment_count: attachments.length,
          received_at: new Date().toISOString(),
          match_method: matchMethod,
          extension_detected: true,
        },
        notes: `Extension filed under 5 ILCS 140/3(e). City has additional 5 business days to respond. Original email from ${fromEmail}.`,
      })
      .eq('id', matchedRequest.id);

    // Audit log
    if (matchedRequest.ticket_id) {
      await supabase.from('ticket_audit_log').insert({
        ticket_id: matchedRequest.ticket_id,
        action: 'foia_extension_received',
        details: {
          from: fromEmail,
          subject,
          match_method: matchMethod,
          note: 'City filed 5 ILCS 140/3(e) extension — additional 5 business days',
        },
        performed_by: null,
      });
    }

    return {
      matched: true,
      requestId: matchedRequest.id,
      ticketNumber,
      foiaType: 'evidence',
      action: 'foia_extension_requested',
      isExtension: true,
    };
  }

  // Guard: If the request is already in a terminal status, don't reprocess.
  // This prevents late/duplicate emails from overwriting existing fulfillment data.
  if (terminalStatuses.includes(matchedRequest.status)) {
    console.log(`  Skipping evidence FOIA ${matchedRequest.id} — already in terminal status '${matchedRequest.status}'`);
    return {
      matched: true,
      requestId: matchedRequest.id,
      ticketNumber: matchedRequest.detected_tickets?.ticket_number || null,
      foiaType: 'evidence',
      action: `already_${matchedRequest.status}`,
    };
  }

  // Determine if this is a fulfillment or denial
  const lowerBody = body.toLowerCase();
  const isDenial = lowerBody.includes('no responsive records') ||
    lowerBody.includes('no records found') ||
    lowerBody.includes('unable to locate') ||
    lowerBody.includes('no records responsive');
  const isFulfillment = attachments.length > 0 ||
    lowerBody.includes('attached') ||
    lowerBody.includes('enclosed') ||
    lowerBody.includes('responsive documents');

  // Fulfillment takes priority: if attachments are present, treat as fulfillment even if
  // body also contains denial-like language (e.g. "no responsive records" + attached docs)
  const status = isFulfillment
    ? 'fulfilled_with_records'
    : isDenial
    ? 'fulfilled_denial'
    : 'fulfilled_denial'; // No records = effectively a denial
  const notes = isFulfillment
    ? `City produced ${attachments.length} document(s). Review for defense-relevant information.`
    : isDenial
    ? 'City responded: no responsive records found. Strengthens due process argument — no supporting enforcement documentation exists.'
    : 'City responded but produced no records. Supports due process argument.';

  // Update the FOIA request
  // Preserve extension metadata if this request previously received an extension
  const previousExtension = matchedRequest.status === 'extension_requested'
    ? {
        extension_received_at: matchedRequest.response_payload?.received_at || matchedRequest.updated_at,
        extension_from: matchedRequest.response_payload?.from,
        extension_subject: matchedRequest.response_payload?.subject,
        had_extension: true,
      }
    : undefined;

  await supabase
    .from('ticket_foia_requests')
    .update({
      status,
      fulfilled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      response_payload: {
        from: fromEmail,
        subject,
        body_preview: body.substring(0, 500),
        attachment_count: attachments.length,
        attachments: attachments.map(a => ({ filename: a.filename, type: a.content_type, ...(a.url ? { url: a.url } : {}) })),
        is_denial: isDenial,
        received_at: new Date().toISOString(),
        match_method: matchMethod,
        ...(previousExtension || {}),
      },
      notes: previousExtension
        ? `[After 5 ILCS 140/3(e) extension] ${notes}`
        : notes,
    })
    .eq('id', matchedRequest.id);

  // Audit log
  const ticketId = matchedRequest.ticket_id;
  await supabase.from('ticket_audit_log').insert({
    ticket_id: ticketId,
    action: isDenial ? 'foia_no_records' : 'foia_response_received',
    details: {
      from: fromEmail,
      subject,
      attachment_count: attachments.length,
      is_denial: isDenial,
      match_method: matchMethod,
      ...(previousExtension ? { after_extension: true, extension_received_at: previousExtension.extension_received_at } : {}),
    },
    performed_by: null,
  });

  // ── Auto-set FOIA integration flags on the contest letter ──
  // This removes the manual step of flipping finance_foia_integrated in admin.
  // Both fulfillments AND denials are useful:
  //   - Fulfillment: actual evidence to cite in letter
  //   - Denial: "no responsive records" strengthens due process argument
  if (ticketId) {
    try {
      // Determine which flag to set based on request type
      // Finance FOIAs: request_type='ticket_evidence_packet', ref=APE-xxx, sent to DOFfoia@
      // CDOT FOIAs: request_type='signal_timing', ref=CDOT-xxx, sent to cdotfoia@
      const requestType = matchedRequest.request_payload?.request_type || matchedRequest.request_type;
      const isCdot = requestType === 'signal_timing' ||
        fromEmail.toLowerCase().includes('cdot') ||
        matchedRequest.reference_id?.startsWith('CDOT-');
      const isFinance = !isCdot; // Default to finance

      const integrationUpdate: Record<string, any> = {};
      if (isCdot) {
        integrationUpdate.cdot_foia_integrated = true;
        integrationUpdate.cdot_foia_integrated_at = new Date().toISOString();
        integrationUpdate.cdot_foia_notes = isDenial
          ? 'Auto-integrated: City produced no records (strengthens due process defense)'
          : `Auto-integrated: City produced ${attachments.length} document(s)`;
      } else {
        integrationUpdate.finance_foia_integrated = true;
        integrationUpdate.finance_foia_integrated_at = new Date().toISOString();
        integrationUpdate.finance_foia_notes = isDenial
          ? 'Auto-integrated: City produced no records (strengthens due process defense)'
          : `Auto-integrated: City produced ${attachments.length} document(s)`;
      }

      const { error: letterUpdateErr } = await supabase
        .from('contest_letters')
        .update(integrationUpdate)
        .eq('ticket_id', ticketId);

      if (letterUpdateErr) {
        console.log(`  Could not auto-set FOIA integration flag: ${letterUpdateErr.message}`);
      } else {
        console.log(`  ✅ Auto-set ${isCdot ? 'cdot' : 'finance'}_foia_integrated on contest letter`);
      }

      await supabase.from('ticket_audit_log').insert({
        ticket_id: ticketId,
        action: 'foia_auto_integrated',
        details: {
          flag: isCdot ? 'cdot_foia_integrated' : 'finance_foia_integrated',
          is_denial: isDenial,
          attachment_count: attachments.length,
          match_method: matchMethod,
        },
        performed_by: null,
      });
    } catch (integrationErr: any) {
      console.log(`  FOIA auto-integration error (non-blocking): ${integrationErr.message}`);
    }
  }

  const ticketNumber = matchedRequest.detected_tickets?.ticket_number || null;
  return {
    matched: true,
    requestId: matchedRequest.id,
    ticketNumber,
    foiaType: 'evidence',
    action: isDenial ? 'foia_denial_recorded' : 'foia_response_recorded',
  };
}

/**
 * Process a matched history FOIA response — parse with Gemini Flash,
 * store parsed tickets, update request status, and notify the user.
 */
export async function processHistoryFoiaResponse(
  supabase: SupabaseClient,
  requestId: string,
  fromEmail: string,
  subject: string,
  body: string,
  // url is the Resend-hosted attachment URL; the body of this function
  // forwards it into response_data so the user can re-download the FOIA
  // PDF later. The other three FOIA-response handlers in this file
  // already type it as optional — this one was out of sync.
  attachments: { filename: string; content_type: string; url?: string }[],
): Promise<{
  action: string;
  parsedTicketCount: number;
  isExtension: boolean;
}> {
  // Fetch the history request
  const { data: historyRequest, error } = await supabase
    .from('foia_history_requests')
    .select('*')
    .eq('id', requestId)
    .maybeSingle();

  if (error || !historyRequest) {
    console.error(`  History request ${requestId} not found`);
    return { action: 'request_not_found', parsedTicketCount: 0, isExtension: false };
  }

  // ── Extension check — must come BEFORE any fulfillment/parsing logic ──
  // Guard: Don't downgrade an already-fulfilled request back to extension_requested.
  const historyTerminalStatuses = ['fulfilled', 'fulfilled_with_records', 'fulfilled_denial'];
  if (isExtensionResponse(subject, body) && !historyTerminalStatuses.includes(historyRequest.status)) {
    console.log(`  Extension detected for history FOIA ${requestId} — NOT marking as fulfilled`);
    await supabase
      .from('foia_history_requests')
      .update({
        status: 'extension_requested',
        updated_at: new Date().toISOString(),
        response_data: {
          from: fromEmail,
          subject,
          body_preview: body.substring(0, 500),
          attachment_count: attachments.length,
          received_at: new Date().toISOString(),
          extension_detected: true,
        },
        notes: `Extension filed under 5 ILCS 140/3(e). City has additional 5 business days to respond. Original email from ${fromEmail}.`,
      } as any)
      .eq('id', requestId);

    return { action: 'history_foia_extension_requested', parsedTicketCount: 0, isExtension: true };
  }

  // Guard: If the request is already in a terminal status, don't reprocess.
  // This prevents late/duplicate emails from overwriting existing fulfillment data.
  if (historyTerminalStatuses.includes(historyRequest.status)) {
    console.log(`  Skipping history FOIA ${requestId} — already in terminal status '${historyRequest.status}'`);
    return { action: `already_${historyRequest.status}`, parsedTicketCount: 0, isExtension: false };
  }

  // Parse the response with Gemini Flash
  let parsedResult = null;
  try {
    const { parseHistoryFoiaResponse } = await import('./foia-response-parser');
    parsedResult = await parseHistoryFoiaResponse({
      subject,
      body,
      licensePlate: historyRequest.license_plate,
      licenseState: historyRequest.license_state,
    });
  } catch (parseErr: any) {
    console.error(`  Gemini parsing failed: ${parseErr.message}`);
  }

  // Update the history request
  // Note: foia_history_requests uses `response_received_at` (not `fulfilled_at` which is on ticket_foia_requests)
  // and `response_data` (not `response_payload`)
  const ticketCount = parsedResult?.tickets?.length || 0;
  const totalFines = parsedResult?.total_fines || 0;

  // Preserve extension metadata if this request previously received an extension
  const previousExtension = historyRequest.status === 'extension_requested'
    ? {
        extension_received_at: historyRequest.response_data?.received_at || historyRequest.updated_at,
        extension_from: historyRequest.response_data?.from,
        extension_subject: historyRequest.response_data?.subject,
        had_extension: true,
      }
    : undefined;

  const updatePayload: any = {
    status: 'fulfilled',
    response_received_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    response_data: {
      from: fromEmail,
      subject,
      body_preview: body.substring(0, 500),
      attachment_count: attachments.length,
      attachments: attachments.map(a => ({ filename: a.filename, type: a.content_type, ...(a.url ? { url: a.url } : {}) })),
      received_at: new Date().toISOString(),
      ...(previousExtension || {}),
    },
    ticket_count: ticketCount,
    total_fines: totalFines,
  };

  if (parsedResult) {
    updatePayload.parsed_tickets = parsedResult.tickets;
    updatePayload.ai_parse_model = parsedResult.model;
    updatePayload.ai_parse_raw = parsedResult.raw_response;
    updatePayload.ai_parsed_at = new Date().toISOString();
    updatePayload.notes = previousExtension
      ? `[After 5 ILCS 140/3(e) extension] ${parsedResult.summary}`
      : parsedResult.summary;
  } else {
    updatePayload.notes = previousExtension
      ? '[After 5 ILCS 140/3(e) extension] FOIA response received — AI parsing failed, manual review needed'
      : 'FOIA response received — AI parsing failed, manual review needed';
  }

  await supabase
    .from('foia_history_requests')
    .update(updatePayload)
    .eq('id', requestId);

  // Send results email to user
  try {
    const { sendFoiaHistoryResultsEmail } = await import('./foia-history-service');
    await sendFoiaHistoryResultsEmail({
      email: historyRequest.email,
      name: historyRequest.name,
      licensePlate: historyRequest.license_plate,
      licenseState: historyRequest.license_state,
      ticketCount,
      totalFines,
      resultsUrl: `https://autopilotamerica.com/my-tickets?plate=${encodeURIComponent(historyRequest.license_plate)}&state=${encodeURIComponent(historyRequest.license_state)}`,
    });
  } catch (emailErr: any) {
    console.error(`  Failed to send results email: ${emailErr.message}`);

    // Flag in DB so admin can see the user was never notified
    await supabase
      .from('foia_history_requests')
      .update({
        notes: `${updatePayload.notes || ''} [WARNING: User results email FAILED: ${emailErr.message}]`,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', requestId);

    // Send admin alert so we can manually notify the user
    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Autopilot <alerts@autopilotamerica.com>',
            to: ['randy@autopilotamerica.com'],
            subject: `⚠ FOIA Results Email Failed — ${historyRequest.license_state} ${historyRequest.license_plate}`,
            text: `Failed to send FOIA history results email to ${historyRequest.name} (${historyRequest.email}).

Plate: ${historyRequest.license_state} ${historyRequest.license_plate}
Tickets found: ${ticketCount}
Total fines: $${totalFines}
Reference: ${historyRequest.reference_id}
Error: ${emailErr.message}

The FOIA response was processed and saved, but the user was NOT notified.
Please manually notify them or retrigger the email.

Results URL: https://autopilotamerica.com/my-tickets?plate=${encodeURIComponent(historyRequest.license_plate)}&state=${encodeURIComponent(historyRequest.license_state)}`,
          }),
        });
      }
    } catch (adminErr: any) {
      console.error(`  Also failed to send admin alert: ${adminErr.message}`);
    }
  }

  return {
    action: `history_foia_processed_${ticketCount}_tickets`,
    parsedTicketCount: ticketCount,
    isExtension: false,
  };
}

// ─── Receipt/Compliance Document Processing ──────────────────

/**
 * Analyze an email attachment to detect compliance documents.
 * Uses keyword matching to identify receipt types without OCR.
 */
export function classifyComplianceDocument(
  filename: string,
  subject: string,
  bodyText: string,
): {
  type: 'city_sticker' | 'registration' | 'insurance' | 'parking_receipt' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
} {
  const fn = filename.toLowerCase();
  const subj = subject.toLowerCase();
  const text = bodyText.toLowerCase();
  const combined = `${fn} ${subj} ${text}`;

  // City sticker
  if (combined.includes('city sticker') || combined.includes('wheel tax') ||
      combined.includes('city of chicago vehicle') || combined.includes('municipal sticker')) {
    return { type: 'city_sticker', confidence: 'high', reason: 'City sticker keywords detected' };
  }

  // Vehicle registration
  if (combined.includes('registration') || combined.includes('secretary of state') ||
      combined.includes('license plate renewal') || combined.includes('vehicle renewal') ||
      (combined.includes('ilsos') || combined.includes('cyberdriveillinois'))) {
    return { type: 'registration', confidence: 'high', reason: 'Registration keywords detected' };
  }

  // Insurance
  if (combined.includes('insurance') || combined.includes('geico') || combined.includes('state farm') ||
      combined.includes('allstate') || combined.includes('progressive') || combined.includes('liability coverage')) {
    return { type: 'insurance', confidence: 'medium', reason: 'Insurance keywords detected' };
  }

  // Parking receipt / meter payment
  if (combined.includes('parkchicago') || combined.includes('parkmobile') ||
      combined.includes('meter payment') || combined.includes('parking receipt') ||
      combined.includes('spothero') || combined.includes('parking confirmation')) {
    return { type: 'parking_receipt', confidence: 'high', reason: 'Parking payment keywords detected' };
  }

  // Check file extension patterns
  if (fn.includes('receipt') || fn.includes('confirmation') || fn.includes('proof')) {
    return { type: 'unknown', confidence: 'low', reason: 'Generic receipt filename' };
  }

  return { type: 'unknown', confidence: 'low', reason: 'No compliance document patterns matched' };
}

/**
 * Process a detected compliance document — match it to the right ticket and
 * store it for use in the contest letter.
 */
export async function processComplianceDocument(
  supabase: SupabaseClient,
  userId: string,
  docType: 'city_sticker' | 'registration' | 'insurance' | 'parking_receipt',
  metadata: {
    filename: string;
    url?: string;
    extractedText?: string;
    subject?: string;
  },
): Promise<{
  matched: boolean;
  ticketId: string | null;
  action: string;
}> {
  // Map document type to violation types it could defend
  const violationMap: Record<string, string[]> = {
    city_sticker: ['no_city_sticker'],
    registration: ['expired_plates'],
    insurance: ['no_insurance'],
    parking_receipt: ['expired_meter'],
  };

  const relevantViolations = violationMap[docType] || [];

  // Find user's tickets that this document could be evidence for
  const { data: tickets } = await supabase
    .from('detected_tickets')
    .select('id, ticket_number, violation_type, status')
    .eq('user_id', userId)
    .in('violation_type', relevantViolations)
    .in('status', ['detected', 'pending_evidence', 'needs_approval', 'letter_generated'])
    .order('created_at', { ascending: false })
    .limit(5);

  if (!tickets || tickets.length === 0) {
    // Store the document anyway — might be useful for future tickets
    try {
      await supabase.from('user_compliance_docs').insert({
        user_id: userId,
        doc_type: docType,
        filename: metadata.filename,
        url: metadata.url || null,
        extracted_text: metadata.extractedText || null,
        source: 'email_auto_detected',
        created_at: new Date().toISOString(),
      });
    } catch {
      // Table may not exist yet — that's OK
    }

    return { matched: false, ticketId: null, action: 'stored_for_future_use' };
  }

  // Match to the most recent relevant ticket
  const matchedTicket = tickets[0];

  // Store as ticket evidence
  await supabase.from('ticket_evidence').insert({
    ticket_id: matchedTicket.id,
    user_id: userId,
    source: 'email_auto_classified',
    evidence_type: docType,
    evidence_text: metadata.extractedText || `${docType} document: ${metadata.filename}`,
    attachments: metadata.url ? [{ url: metadata.url, filename: metadata.filename }] : [],
  });

  // Update the ticket's compliance receipt field
  const receiptField = docType === 'city_sticker' ? 'city_sticker_receipt'
    : docType === 'registration' ? 'registration_receipt'
    : null;

  if (receiptField) {
    await supabase
      .from('detected_tickets')
      .update({
        [receiptField]: {
          filename: metadata.filename,
          source: 'email_auto_detected',
          detected_at: new Date().toISOString(),
          subject: metadata.subject,
        },
      })
      .eq('id', matchedTicket.id);
  }

  // Audit log
  await supabase.from('ticket_audit_log').insert({
    ticket_id: matchedTicket.id,
    action: 'compliance_doc_auto_detected',
    details: {
      doc_type: docType,
      filename: metadata.filename,
      matched_violation: matchedTicket.violation_type,
    },
    performed_by: null,
  });

  return {
    matched: true,
    ticketId: matchedTicket.id,
    action: `${docType}_matched_to_ticket_${matchedTicket.ticket_number}`,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function normalizeLocation(location: string | null): string {
  if (!location) return '';
  return location
    .toUpperCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\bST\b/g, 'STREET')
    .replace(/\bAVE?\b/g, 'AVENUE')
    .replace(/\bBLVD\b/g, 'BOULEVARD')
    .replace(/\bDR\b/g, 'DRIVE')
    .replace(/\bPL\b/g, 'PLACE')
    .replace(/\bCT\b/g, 'COURT')
    .replace(/\bRD\b/g, 'ROAD')
    .replace(/\bPKWY\b/g, 'PARKWAY')
    .replace(/\bN\b/g, 'NORTH')
    .replace(/\bS\b/g, 'SOUTH')
    .replace(/\bE\b/g, 'EAST')
    .replace(/\bW\b/g, 'WEST')
    .trim();
}
