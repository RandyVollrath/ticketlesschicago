import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Ticket Lifecycle Dashboard API
 *
 * Returns a comprehensive view of every ticket grouped by user, including:
 * - Full ticket info
 * - All communications sent (reminders, last-chance, consent)
 * - All evidence gathered (used and not used, with reasons)
 * - Letter status and content
 * - Delivery tracking (Lob status, tracking events)
 * - Contest outcome
 * - Full audit timeline
 */

const EVIDENCE_SOURCE_META: Record<string, { label: string; icon: string; description: string }> = {
  weather: { label: 'Weather Data', icon: '🌦', description: 'Historical weather from Open-Meteo archive API' },
  foia_data: { label: 'FOIA Court Records', icon: '⚖', description: 'Real hearing outcomes from 1.18M Chicago DOAH records' },
  court_data: { label: 'Court Case Analysis', icon: '📊', description: 'Smart-matched cases by evidence similarity' },
  gps_parking: { label: 'GPS Parking Data', icon: '📍', description: 'Mobile app GPS departure/arrival proof' },
  street_view: { label: 'Google Street View', icon: '📸', description: 'Multi-angle location imagery' },
  street_view_ai_analysis: { label: 'AI Sign Analysis', icon: '🤖', description: 'Claude Vision sign condition analysis' },
  signage_issue_found: { label: 'Signage Issue Found', icon: '⚠', description: 'AI detected sign visibility problem' },
  contest_kit: { label: 'Contest Kit', icon: '📋', description: 'Violation-specific defense template with FOIA win rates' },
  street_cleaning_schedule: { label: 'Street Cleaning DB', icon: '🧹', description: 'Schedule verification from city data' },
  city_sticker: { label: 'City Sticker Receipt', icon: '🏷', description: 'Forwarded purchase receipt from user' },
  registration: { label: 'Registration Receipt', icon: '📄', description: 'Forwarded renewal receipt from user' },
  red_light_gps: { label: 'Red Light GPS', icon: '🚦', description: 'GPS speed data at camera location' },
  speed_camera_gps: { label: 'Speed Camera GPS', icon: '📹', description: 'GPS speed history at camera location' },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { search, status, stage } = req.query;

    // 1. Fetch all detected tickets
    let ticketQuery = supabase
      .from('detected_tickets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    const { data: tickets, error: ticketError } = await ticketQuery;
    if (ticketError) return res.status(500).json({ error: sanitizeErrorMessage(ticketError) });
    if (!tickets || tickets.length === 0) {
      return res.status(200).json({ success: true, users: [], summary: getEmptySummary() });
    }

    const ticketIds = tickets.map(t => t.id);
    const userIds = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];

    // 2. Batch-fetch all related data in parallel
    const [
      lettersResult,
      usersResult,
      auditResult,
      outcomesResult,
      foiaResult,
    ] = await Promise.all([
      supabase.from('contest_letters').select('*').in('ticket_id', ticketIds),
      userIds.length > 0
        ? supabase.from('user_profiles').select('user_id, email, first_name, last_name, license_plate, license_state, mailing_address, contest_consent, contest_consent_at, consent_contest_signature, is_paid, consent_reminder_sent_at').in('user_id', userIds)
        : Promise.resolve({ data: [] }),
      supabase.from('ticket_audit_log').select('*').in('ticket_id', ticketIds).order('created_at', { ascending: true }),
      supabase.from('contest_outcomes').select('*').in('ticket_id', ticketIds),
      supabase.from('ticket_foia_requests').select('*').in('ticket_id', ticketIds),
    ]);

    // 3. Build lookup maps
    const lettersByTicket: Record<string, any> = {};
    for (const l of (lettersResult.data || [])) {
      lettersByTicket[l.ticket_id] = l;
    }

    const userMap: Record<string, any> = {};
    for (const u of (usersResult.data || [])) {
      userMap[u.user_id] = u;
    }

    const auditByTicket: Record<string, any[]> = {};
    for (const a of (auditResult.data || [])) {
      if (!auditByTicket[a.ticket_id]) auditByTicket[a.ticket_id] = [];
      auditByTicket[a.ticket_id].push(a);
    }

    const outcomeByTicket: Record<string, any> = {};
    for (const o of (outcomesResult.data || [])) {
      outcomeByTicket[o.ticket_id] = o;
    }

    const foiaByTicket: Record<string, any> = {};
    for (const f of (foiaResult.data || [])) {
      foiaByTicket[f.ticket_id] = f;
    }

    // 4. Build per-ticket lifecycle objects
    const ticketLifecycles = tickets.map(ticket => {
      const letter = lettersByTicket[ticket.id];
      const user = userMap[ticket.user_id];
      const auditLogs = auditByTicket[ticket.id] || [];
      const outcome = outcomeByTicket[ticket.id];
      const foia = foiaByTicket[ticket.id];

      // --- Communications timeline ---
      const communications: any[] = [];

      // Ticket detection notification
      communications.push({
        type: 'ticket_detected',
        label: 'Ticket Detected',
        date: ticket.created_at,
        details: `Ticket #${ticket.ticket_number} found via ${ticket.source || 'portal scrape'}`,
      });

      // Reminders from detected_tickets columns
      if (ticket.reminder_count >= 1 && ticket.last_reminder_sent_at) {
        communications.push({
          type: 'reminder',
          label: 'First Reminder (Day 5)',
          date: ticket.last_reminder_sent_at,
          details: 'Submit evidence to strengthen your letter',
        });
      }
      if (ticket.reminder_count >= 2) {
        communications.push({
          type: 'reminder',
          label: 'Second Reminder (Day 10)',
          date: ticket.last_reminder_sent_at, // Best available timestamp
          details: 'Submit evidence soon',
        });
      }
      if (ticket.last_chance_sent_at) {
        communications.push({
          type: 'last_chance',
          label: 'LAST CHANCE (Day 17)',
          date: ticket.last_chance_sent_at,
          details: 'Letter will auto-send in 48 hours',
        });
      }

      // Consent reminder from user profile
      if (user?.consent_reminder_sent_at && letter?.status === 'awaiting_consent') {
        communications.push({
          type: 'consent_reminder',
          label: 'Consent Reminder',
          date: user.consent_reminder_sent_at,
          details: 'Authorization needed to mail letter',
        });
      }

      // Letter-related comms from audit log
      for (const audit of auditLogs) {
        if (audit.action === 'auto_send_safety_net') {
          communications.push({
            type: 'auto_send',
            label: 'Auto-Send Safety Net (Day 19)',
            date: audit.created_at,
            details: audit.details?.reason || 'Auto-sending before deadline',
          });
        }
        if (audit.action === 'letter_delivered') {
          communications.push({
            type: 'delivery_notification',
            label: 'Delivery Notification Sent',
            date: audit.created_at,
            details: 'User notified that letter was delivered',
          });
        }
        if (audit.action === 'letter_returned') {
          communications.push({
            type: 'return_notification',
            label: 'Return Notification Sent',
            date: audit.created_at,
            details: 'User notified that letter was returned',
          });
        }
      }

      // Sort communications by date
      communications.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // --- Evidence analysis ---
      const evidenceAudit = auditLogs.find(a => a.action === 'automated_evidence_gathered');
      const evidenceDetails = evidenceAudit?.details || {};
      const letterContent = letter?.letter_content || letter?.letter_text || '';
      const hasLetter = !!letterContent;
      const letterDefense = letter?.defense_type || '';

      const evidenceSources = buildEvidenceAnalysis(evidenceDetails, letter, hasLetter, letterContent, letterDefense, ticket);

      // --- Letter lifecycle ---
      const letterLifecycle = buildLetterLifecycle(letter, auditLogs);

      // --- Delivery tracking ---
      const delivery = letter ? {
        lob_letter_id: letter.lob_letter_id || null,
        lob_status: letter.lob_status || letter.delivery_status || null,
        mailed_at: letter.mailed_at || null,
        expected_delivery_date: letter.expected_delivery_date || letter.lob_expected_delivery || null,
        delivered_at: letter.delivered_at || null,
        returned_at: letter.returned_at || null,
        tracking_events: letter.tracking_events || null,
        last_tracking_update: letter.last_tracking_update || null,
      } : null;

      // --- Stage computation ---
      const lifecycle_stage = computeLifecycleStage(ticket, letter, outcome);

      // --- Days calculation (Chicago timezone) ---
      let daysElapsed: number | null = null;
      let daysRemaining: number | null = null;
      if (ticket.violation_date) {
        const chicagoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const chicagoViolation = new Date(new Date(ticket.violation_date).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
        const nowDateOnly = new Date(chicagoNow.getFullYear(), chicagoNow.getMonth(), chicagoNow.getDate());
        const violationDateOnly = new Date(chicagoViolation.getFullYear(), chicagoViolation.getMonth(), chicagoViolation.getDate());
        daysElapsed = Math.round((nowDateOnly.getTime() - violationDateOnly.getTime()) / (1000 * 60 * 60 * 24));
        daysRemaining = Math.max(0, 21 - daysElapsed);
      }

      return {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        plate: ticket.plate,
        state: ticket.state,
        violation_date: ticket.violation_date,
        violation_description: ticket.violation_description || ticket.violation_code,
        violation_type: ticket.violation_type,
        amount: ticket.amount,
        status: ticket.status,
        created_at: ticket.created_at,
        source: ticket.source,
        days_elapsed: daysElapsed,
        days_remaining: daysRemaining,
        evidence_deadline: ticket.evidence_deadline,
        // User
        user_id: ticket.user_id,
        user_email: user?.email || null,
        user_name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || null : null,
        // Lifecycle
        lifecycle_stage,
        // Communications
        communications,
        // Evidence
        evidence_sources: evidenceSources,
        evidence_used_count: evidenceSources.filter(e => e.status === 'used').length,
        evidence_checked_count: evidenceSources.filter(e => e.status !== 'not_checked').length,
        has_user_evidence: !!ticket.user_evidence,
        user_evidence_summary: summarizeUserEvidence(ticket.user_evidence),
        // Letter
        letter_lifecycle: letterLifecycle,
        letter_id: letter?.id || null,
        letter_status: letter?.status || null,
        defense_type: letter?.defense_type || null,
        letter_has_content: hasLetter,
        // Delivery
        delivery,
        // FOIA
        foia_request: foia ? {
          status: foia.status,
          requested_at: foia.requested_at,
          sent_at: foia.sent_at,
          fulfilled_at: foia.fulfilled_at,
          notes: foia.notes,
        } : null,
        // Outcome
        outcome: outcome ? {
          result: outcome.outcome,
          outcome_date: outcome.outcome_date,
          original_amount: outcome.original_amount,
          final_amount: outcome.final_amount,
          amount_saved: outcome.amount_saved,
          hearing_type: outcome.hearing_type,
          hearing_date: outcome.hearing_date,
          primary_defense: outcome.primary_defense,
        } : null,
        // Audit log (full timeline)
        audit_log: auditLogs.map(a => ({
          action: a.action,
          details: a.details,
          date: a.created_at,
          performed_by: a.performed_by,
        })),
      };
    });

    // 5. Group by user
    const userGroups: Record<string, any> = {};
    for (const tl of ticketLifecycles) {
      const uid = tl.user_id || 'unknown';
      if (!userGroups[uid]) {
        const user = userMap[uid];
        userGroups[uid] = {
          user_id: uid,
          email: user?.email || 'Unknown',
          name: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || null : null,
          plate: user?.license_plate || null,
          plate_state: user?.license_state || null,
          has_mailing_address: !!user?.mailing_address,
          contest_consent: user?.contest_consent || false,
          consent_signature: user?.consent_contest_signature || null,
          is_paid: user?.is_paid || false,
          tickets: [],
        };
      }
      userGroups[uid].tickets.push(tl);
    }

    // Convert to array, add computed stats per user
    let users = Object.values(userGroups).map((group: any) => ({
      ...group,
      ticket_count: group.tickets.length,
      total_amount: group.tickets.reduce((sum: number, t: any) => sum + (t.amount || 0), 0),
      total_saved: group.tickets.reduce((sum: number, t: any) => sum + (t.outcome?.amount_saved || 0), 0),
      stages: {
        detected: group.tickets.filter((t: any) => t.lifecycle_stage.key === 'detected').length,
        evidence: group.tickets.filter((t: any) => t.lifecycle_stage.key === 'evidence_gathering').length,
        letter_ready: group.tickets.filter((t: any) => t.lifecycle_stage.key === 'letter_ready').length,
        mailed: group.tickets.filter((t: any) => t.lifecycle_stage.key === 'mailed').length,
        delivered: group.tickets.filter((t: any) => t.lifecycle_stage.key === 'delivered').length,
        outcome: group.tickets.filter((t: any) => t.lifecycle_stage.key === 'outcome').length,
      },
    }));

    // 6. Apply filters
    if (search && typeof search === 'string' && search.trim()) {
      const q = search.toLowerCase().trim();
      users = users.filter((u: any) =>
        u.email?.toLowerCase().includes(q) ||
        u.name?.toLowerCase().includes(q) ||
        u.plate?.toLowerCase().includes(q) ||
        u.tickets.some((t: any) =>
          t.ticket_number?.toLowerCase().includes(q) ||
          t.violation_description?.toLowerCase().includes(q)
        )
      );
    }

    if (stage && typeof stage === 'string' && stage !== 'all') {
      users = users.filter((u: any) =>
        u.tickets.some((t: any) => t.lifecycle_stage.key === stage)
      );
      // Also filter tickets within each user to only show matching stage
      users = users.map((u: any) => ({
        ...u,
        tickets: u.tickets.filter((t: any) => t.lifecycle_stage.key === stage),
        ticket_count: u.tickets.filter((t: any) => t.lifecycle_stage.key === stage).length,
      }));
    }

    // 7. Build summary
    const allTickets = ticketLifecycles;
    const summary = {
      total_users: Object.keys(userGroups).length,
      total_tickets: allTickets.length,
      total_amount_at_stake: allTickets.reduce((s, t) => s + (t.amount || 0), 0),
      total_saved: allTickets.reduce((s, t) => s + (t.outcome?.amount_saved || 0), 0),
      by_stage: {
        detected: allTickets.filter(t => t.lifecycle_stage.key === 'detected').length,
        evidence_gathering: allTickets.filter(t => t.lifecycle_stage.key === 'evidence_gathering').length,
        letter_ready: allTickets.filter(t => t.lifecycle_stage.key === 'letter_ready').length,
        mailed: allTickets.filter(t => t.lifecycle_stage.key === 'mailed').length,
        delivered: allTickets.filter(t => t.lifecycle_stage.key === 'delivered').length,
        outcome: allTickets.filter(t => t.lifecycle_stage.key === 'outcome').length,
      },
      outcomes: {
        dismissed: allTickets.filter(t => t.outcome?.result === 'dismissed').length,
        reduced: allTickets.filter(t => t.outcome?.result === 'reduced').length,
        upheld: allTickets.filter(t => t.outcome?.result === 'upheld').length,
        pending: allTickets.filter(t => !t.outcome).length,
      },
      urgent_tickets: allTickets.filter(t => t.days_remaining !== null && t.days_remaining <= 5 && !t.delivery).length,
    };

    return res.status(200).json({ success: true, users, summary });
  } catch (error: any) {
    console.error('Ticket lifecycle API error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

function buildEvidenceAnalysis(details: any, letter: any, hasLetter: boolean, letterContent: string, letterDefense: string, ticket: any) {
  const sources = [];

  // Contest kit
  sources.push({
    key: 'contest_kit',
    ...EVIDENCE_SOURCE_META['contest_kit'],
    status: letterDefense ? 'used' : 'not_applicable',
    reason: letterDefense
      ? `Defense template: ${letterDefense.replace(/_/g, ' ')}`
      : 'No specific defense template matched',
    data: letterDefense ? { defense_type: letterDefense } : null,
  });

  // FOIA court records
  const foiaFound = !!details.foiaWinRate?.totalContested ||
    (hasLetter && /FOIA|hearing outcome|administrative hearing|contest.*rate|success rate|dismissal rate|\d+%.*dismissed|dismissed.*\d+%/i.test(letterContent));
  sources.push({
    key: 'foia_data',
    ...EVIDENCE_SOURCE_META['foia_data'],
    status: foiaFound ? 'used' : 'checked_not_used',
    reason: foiaFound
      ? `${details.foiaWinRate?.totalContested || 'N/A'} matching cases found, ${details.foiaWinRate?.winRate || 'N/A'}% dismissal rate`
      : 'No matching FOIA court records found for this violation type/location',
    data: details.foiaWinRate || null,
  });

  // Weather
  const weatherFound = !!details.weather?.summary ||
    (hasLetter && /weather.*condition|rain.*day|snow.*day|storm|poor visibility|inclement weather|temperature.*degree/i.test(letterContent));
  const weatherRelevant = details.weather?.defenseRelevant;
  sources.push({
    key: 'weather',
    ...EVIDENCE_SOURCE_META['weather'],
    status: weatherFound && weatherRelevant ? 'used' : weatherFound ? 'checked_not_used' : 'checked_not_used',
    reason: weatherFound
      ? (weatherRelevant
        ? `Weather conditions support defense: ${details.weather?.summary || 'adverse conditions found'}`
        : `Weather checked but not defense-relevant: ${details.weather?.summary || 'clear conditions'}`)
      : 'Weather data checked — no adverse conditions at time of violation',
    data: details.weather || null,
  });

  // Street View
  const svFound = !!details.streetView?.hasImagery ||
    !!(letter?.street_view_exhibit_urls && letter.street_view_exhibit_urls.length > 0) ||
    (hasLetter && /street view|google.*street|exhibit.*photograph|attached.*photo/i.test(letterContent));
  sources.push({
    key: 'street_view',
    ...EVIDENCE_SOURCE_META['street_view'],
    status: svFound ? 'used' : 'checked_not_used',
    reason: svFound
      ? `${letter?.street_view_exhibit_urls?.length || 'Multiple'} Street View image(s) captured${letter?.street_view_date ? ` from ${letter.street_view_date}` : ''}`
      : 'No Street View imagery available for this location/date',
    data: details.streetView || (letter?.street_view_exhibit_urls ? {
      urls: letter.street_view_exhibit_urls,
      date: letter.street_view_date,
      address: letter.street_view_address,
    } : null),
  });

  // AI Sign Analysis
  const aiFound = !!details.streetViewAI ||
    (hasLetter && /sign.*analysis|visibility.*analysis|signage.*condition|AI.*analysis|sign.*obstructed|sign.*obscured|sign.*not visible/i.test(letterContent));
  sources.push({
    key: 'street_view_ai_analysis',
    ...EVIDENCE_SOURCE_META['street_view_ai_analysis'],
    status: aiFound ? 'used' : svFound ? 'checked_not_used' : 'not_checked',
    reason: aiFound
      ? 'AI analysis found signage issues that support the defense'
      : svFound
        ? 'AI analyzed Street View but found no signage issues'
        : 'No Street View imagery to analyze',
    data: details.streetViewAI || null,
  });

  // GPS parking
  const gpsFound = !!details.parkingHistory?.matchFound ||
    (hasLetter && /GPS.*data|GPS.*record|parking.*data|departure.*time|arrival.*time|mobile.*app.*record/i.test(letterContent));
  sources.push({
    key: 'gps_parking',
    ...EVIDENCE_SOURCE_META['gps_parking'],
    status: gpsFound ? 'used' : 'not_checked',
    reason: gpsFound
      ? 'GPS parking records match — departure/arrival times support defense'
      : 'No GPS parking data available (user may not have mobile app)',
    data: details.parkingHistory || null,
  });

  // Registration receipt
  const regFound = hasLetter && /registration.*renew|renewed.*registration|registration.*receipt|renewed.*plate|proof.*renewal|valid.*registration/i.test(letterContent);
  sources.push({
    key: 'registration',
    ...EVIDENCE_SOURCE_META['registration'],
    status: regFound ? 'used' : ticket.user_evidence ? 'checked_not_used' : 'not_checked',
    reason: regFound
      ? 'Registration renewal receipt provided by user — proves timely renewal'
      : ticket.user_evidence
        ? 'User submitted evidence but no registration receipt found'
        : 'No user-submitted evidence (registration receipt not available)',
    data: null,
  });

  // City sticker
  const stickerFound = hasLetter && /city.*sticker|wheel.*tax|sticker.*purchase|receipt.*sticker|vehicle.*sticker|sticker.*valid/i.test(letterContent);
  sources.push({
    key: 'city_sticker',
    ...EVIDENCE_SOURCE_META['city_sticker'],
    status: stickerFound ? 'used' : ticket.user_evidence ? 'checked_not_used' : 'not_checked',
    reason: stickerFound
      ? 'City sticker purchase receipt provided — proves valid sticker'
      : ticket.user_evidence
        ? 'User evidence reviewed but no city sticker receipt found'
        : 'No user-submitted evidence (sticker receipt not available)',
    data: null,
  });

  // Street cleaning schedule
  const cleaningFound = !!details.streetCleaning?.relevant ||
    (hasLetter && /street.*clean.*schedule|sweep.*schedule|cleaning.*schedule|not.*scheduled.*clean/i.test(letterContent));
  sources.push({
    key: 'street_cleaning_schedule',
    ...EVIDENCE_SOURCE_META['street_cleaning_schedule'],
    status: cleaningFound ? 'used' : details.streetCleaning ? 'checked_not_used' : 'not_applicable',
    reason: cleaningFound
      ? 'Street cleaning schedule confirms no cleaning was scheduled'
      : details.streetCleaning
        ? 'Street cleaning schedule checked — cleaning WAS scheduled at time of violation'
        : 'Not a street cleaning violation — schedule check not applicable',
    data: details.streetCleaning || null,
  });

  // Court data
  const courtFound = !!details.courtData ||
    (hasLetter && /court record|case.*similar|hearing data|adjudication.*record/i.test(letterContent));
  sources.push({
    key: 'court_data',
    ...EVIDENCE_SOURCE_META['court_data'],
    status: courtFound ? 'used' : 'checked_not_used',
    reason: courtFound
      ? 'Similar court cases found to support defense strategy'
      : 'No closely matching court cases found',
    data: details.courtData || null,
  });

  return sources;
}

function buildLetterLifecycle(letter: any, auditLogs: any[]) {
  if (!letter) return null;

  const steps: any[] = [];

  steps.push({
    step: 'created',
    label: 'Letter Created',
    date: letter.created_at,
    completed: true,
  });

  if (letter.evidence_integrated_at) {
    steps.push({
      step: 'evidence_integrated',
      label: 'Evidence Integrated',
      date: letter.evidence_integrated_at,
      completed: true,
    });
  }

  const approvedAudit = auditLogs.find(a =>
    a.action === 'letter_approved' || a.action === 'auto_send_safety_net'
  );
  steps.push({
    step: 'approved',
    label: approvedAudit?.action === 'auto_send_safety_net' ? 'Auto-Approved (Safety Net)' : 'Approved',
    date: letter.approved_at || approvedAudit?.created_at || null,
    completed: !!letter.approved_at || !!approvedAudit ||
      ['approved', 'sent', 'mailed'].includes(letter.status),
  });

  steps.push({
    step: 'mailed',
    label: 'Mailed via Lob',
    date: letter.mailed_at,
    completed: !!letter.mailed_at,
  });

  const deliveryStatus = letter.delivery_status || letter.lob_status;
  steps.push({
    step: 'in_transit',
    label: 'In Transit',
    date: auditLogs.find(a => a.action === 'letter_in_transit')?.created_at || null,
    completed: ['in_transit', 'in_local_area', 'out_for_delivery', 'delivered'].includes(deliveryStatus),
  });

  steps.push({
    step: 'delivered',
    label: 'Delivered to City Hall',
    date: letter.delivered_at || null,
    completed: deliveryStatus === 'delivered' || !!letter.delivered_at,
  });

  return steps;
}

function computeLifecycleStage(ticket: any, letter: any, outcome: any) {
  if (outcome) {
    const color = outcome.outcome === 'dismissed' ? '#10B981' :
      outcome.outcome === 'reduced' ? '#3B82F6' :
        outcome.outcome === 'upheld' ? '#EF4444' : '#6B7280';
    return { key: 'outcome', label: `Outcome: ${outcome.outcome}`, color };
  }

  const deliveryStatus = letter?.delivery_status || letter?.lob_status;
  if (deliveryStatus === 'delivered' || letter?.delivered_at) {
    return { key: 'delivered', label: 'Delivered to City Hall', color: '#10B981' };
  }

  if (letter?.mailed_at || deliveryStatus === 'in_transit' || deliveryStatus === 'in_local_area' || deliveryStatus === 'out_for_delivery') {
    return { key: 'mailed', label: 'Mailed / In Transit', color: '#3B82F6' };
  }

  if (deliveryStatus === 'returned' || letter?.returned_at) {
    return { key: 'mailed', label: 'RETURNED to Sender', color: '#EF4444' };
  }

  if (letter?.letter_content || letter?.letter_text) {
    return { key: 'letter_ready', label: 'Letter Ready', color: '#8B5CF6' };
  }

  if (ticket.status === 'pending_evidence' || ticket.status === 'needs_approval') {
    return { key: 'evidence_gathering', label: 'Evidence Gathering', color: '#F59E0B' };
  }

  return { key: 'detected', label: 'Ticket Detected', color: '#6B7280' };
}

function summarizeUserEvidence(userEvidence: any): string | null {
  if (!userEvidence) return null;
  try {
    const parsed = typeof userEvidence === 'string' ? JSON.parse(userEvidence) : userEvidence;
    if (Array.isArray(parsed)) {
      return `${parsed.length} file(s) submitted`;
    }
    if (parsed.attachments) {
      return `${parsed.attachments.length} attachment(s) from email`;
    }
    if (parsed.text || parsed.body) {
      return 'Text evidence submitted via email';
    }
    return 'Evidence submitted';
  } catch {
    return 'Evidence submitted';
  }
}

function getEmptySummary() {
  return {
    total_users: 0,
    total_tickets: 0,
    total_amount_at_stake: 0,
    total_saved: 0,
    by_stage: { detected: 0, evidence_gathering: 0, letter_ready: 0, mailed: 0, delivered: 0, outcome: 0 },
    outcomes: { dismissed: 0, reduced: 0, upheld: 0, pending: 0 },
    urgent_tickets: 0,
  };
}

export const config = {
  maxDuration: 30,
};
