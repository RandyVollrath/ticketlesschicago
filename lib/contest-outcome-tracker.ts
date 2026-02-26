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
  if (
    portalData.current_amount_due > 0 &&
    storedTicket.amount &&
    portalData.current_amount_due < storedTicket.amount * 0.95 // at least 5% reduction
  ) {
    return {
      outcome: 'reduced',
      details: `Amount reduced from $${storedTicket.amount} to $${portalData.current_amount_due}`,
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
    // Just update the ticket status — no contest_outcomes record yet
    await supabase
      .from('detected_tickets')
      .update({
        status: 'hearing_scheduled',
        last_portal_status: 'hearing',
        last_portal_check: now,
      })
      .eq('id', ticket.id);

    // Audit log
    await supabase.from('ticket_audit_log').insert({
      ticket_id: ticket.id,
      action: 'hearing_scheduled',
      details: { portal_status: details },
      performed_by: null,
    });

    console.log(`    📅 Hearing scheduled for ${ticket.ticket_number}`);
    return;
  }

  // Map to contest_outcomes outcome type
  const outcomeType = outcome === 'dismissed' ? 'dismissed'
    : outcome === 'reduced' ? 'reduced'
    : 'upheld';

  // Fetch the contest letter for this ticket (for letter_id)
  const { data: letter } = await supabase
    .from('contest_letters')
    .select('id, defense_type, evidence_integrated')
    .eq('ticket_id', ticket.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  // Record the outcome using existing learning infrastructure
  try {
    await recordContestOutcome(supabase, {
      ticket_id: ticket.id,
      letter_id: letter?.id || null,
      user_id: ticket.user_id,
      outcome: outcomeType,
      outcome_date: new Date().toISOString().split('T')[0],
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

  // Update ticket status
  const ticketStatus = outcome === 'dismissed' ? 'won'
    : outcome === 'reduced' ? 'reduced'
    : 'lost';

  await supabase
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

  // Audit log
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

  console.log(`    ${outcome === 'dismissed' ? '🎉' : outcome === 'reduced' ? '💰' : '❌'} ${ticket.ticket_number}: ${details}`);
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
    .single();

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
      .single();

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
 * Check if an incoming email is a FOIA response from the City of Chicago.
 * Returns the matched ticket_foia_request if found.
 */
export function isFoiaResponseEmail(
  fromEmail: string,
  subject: string,
  body: string,
): boolean {
  const from = fromEmail.toLowerCase();
  const subj = subject.toLowerCase();
  const text = body.toLowerCase();

  // Check sender — DOF FOIA office
  const foiaSenders = [
    'doffoia@cityofchicago.org',
    'foia@cityofchicago.org',
    'finance.foia@cityofchicago.org',
    'doah@cityofchicago.org', // Department of Administrative Hearings
    'noreply@cityofchicago.org',
  ];
  const isFromCity = foiaSenders.some(s => from.includes(s)) || from.includes('cityofchicago.org');

  // Check subject keywords
  const foiaKeywords = ['foia', 'freedom of information', 'records request', 'public records', 'responsive documents', 'enforcement records'];
  const hasKeyword = foiaKeywords.some(k => subj.includes(k) || text.includes(k));

  return isFromCity && hasKeyword;
}

/**
 * Process a FOIA response email — match it to a pending request,
 * update status, and extract any useful information.
 */
export async function processFoiaResponse(
  supabase: SupabaseClient,
  fromEmail: string,
  subject: string,
  body: string,
  attachments: { filename: string; content_type: string; url?: string }[],
): Promise<{
  matched: boolean;
  requestId: string | null;
  ticketNumber: string | null;
  action: string;
}> {
  // Try to extract ticket number from the email
  const ticketNumberMatch = body.match(/(?:ticket|citation|receivable)[\s#:]*(\d{10,})/i)
    || subject.match(/(?:ticket|citation|receivable)[\s#:]*(\d{10,})/i);

  // Find pending FOIA requests
  const { data: pendingRequests } = await supabase
    .from('ticket_foia_requests')
    .select('*, detected_tickets!inner(ticket_number, user_id)')
    .eq('status', 'sent')
    .order('sent_at', { ascending: true });

  if (!pendingRequests || pendingRequests.length === 0) {
    return { matched: false, requestId: null, ticketNumber: null, action: 'no_pending_requests' };
  }

  // Try to match by ticket number if we extracted one
  let matchedRequest = null;
  if (ticketNumberMatch) {
    const extractedNumber = ticketNumberMatch[1];
    matchedRequest = pendingRequests.find((r: any) =>
      r.detected_tickets?.ticket_number === extractedNumber ||
      r.request_payload?.ticket_number === extractedNumber
    );
  }

  // If no ticket number match, check if only one FOIA is pending (unambiguous)
  if (!matchedRequest && pendingRequests.length === 1) {
    matchedRequest = pendingRequests[0];
  }

  if (!matchedRequest) {
    return {
      matched: false,
      requestId: null,
      ticketNumber: ticketNumberMatch?.[1] || null,
      action: 'no_match_found',
    };
  }

  // Determine if this is a fulfillment or a denial
  const lowerBody = body.toLowerCase();
  const isDenial = lowerBody.includes('no responsive records') ||
    lowerBody.includes('no records found') ||
    lowerBody.includes('unable to locate');
  const isFulfillment = attachments.length > 0 ||
    lowerBody.includes('attached') ||
    lowerBody.includes('enclosed') ||
    lowerBody.includes('responsive documents');

  const status = isDenial ? 'fulfilled' : isFulfillment ? 'fulfilled' : 'fulfilled';
  const notes = isDenial
    ? 'City responded: no responsive records found. This strengthens the "Prima Facie Case Not Established" argument.'
    : isFulfillment
    ? `City produced ${attachments.length} document(s). Review for defense-relevant information.`
    : 'City responded to FOIA request. Review content for defense relevance.';

  // Update the FOIA request
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
        attachments: attachments.map(a => ({ filename: a.filename, type: a.content_type })),
        is_denial: isDenial,
        received_at: new Date().toISOString(),
      },
      notes,
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
    },
    performed_by: null,
  });

  return {
    matched: true,
    requestId: matchedRequest.id,
    ticketNumber: (matchedRequest as any).detected_tickets?.ticket_number || null,
    action: isDenial ? 'foia_denial_recorded' : 'foia_response_recorded',
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
