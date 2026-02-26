import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Contest Pipeline API — Rich admin view
 *
 * Returns tickets with full evidence details, letter content, stage tracking,
 * and everything needed for the admin contest pipeline dashboard.
 */

// All evidence source types the system can gather
const EVIDENCE_SOURCE_LABELS: Record<string, { label: string; icon: string; description: string }> = {
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
  camera_school_zone: { label: 'School Zone Calendar', icon: '🏫', description: 'CPS calendar check — was ticket on a school day?' },
  camera_yellow_light: { label: 'IDOT Yellow Minimum', icon: '🚦', description: 'IDOT minimum yellow light timing reference' },
};

// Win rates by violation type (from FOIA data)
const VIOLATION_WIN_RATES: Record<string, number> = {
  expired_plates: 75,
  no_city_sticker: 70,
  disabled_zone: 68,
  expired_meter: 67,
  commercial_loading: 59,
  no_standing_time_restricted: 58,
  residential_permit: 54,
  missing_plate: 54,
  fire_hydrant: 44,
  street_cleaning: 34,
  snow_route: 30,
  double_parking: 25,
  parking_alley: 25,
  bus_lane: 25,
  bus_stop: 20,
  bike_lane: 18,
  red_light: 21,
  speed_camera: 18,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { limit = '100', stage, id } = req.query;

    // Single ticket detail view
    if (id) {
      return await getTicketDetail(id as string, res);
    }

    // List view: all tickets with evidence summary
    const { data: tickets, error } = await supabase
      .from('detected_tickets')
      .select(`
        id,
        ticket_number,
        status,
        violation_description,
        violation_code,
        violation_type,
        amount,
        user_evidence,
        created_at,
        user_id,
        evidence_deadline,
        evidence_requested_at,
        evidence_received_at,
        auto_send_deadline,
        source,
        plate,
        state,
        violation_date
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit as string));

    if (error) {
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }

    if (!tickets || tickets.length === 0) {
      return res.status(200).json({ success: true, tickets: [], stats: getEmptyStats() });
    }

    // Batch fetch: letters, users, audit logs
    const ticketIds = tickets.map(t => t.id);
    const userIds = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];

    const [lettersResult, usersResult, auditResult, emailAuditResult, foiaResult] = await Promise.all([
      supabase
        .from('contest_letters')
        .select(`
          id, ticket_id, status, defense_type, letter_content, letter_text,
          evidence_integrated, evidence_integrated_at,
          mailed_at, lob_status, lob_expected_delivery, lob_letter_id,
          using_default_address, created_at,
          street_view_exhibit_urls, street_view_date, street_view_address
        `)
        .in('ticket_id', ticketIds),
      userIds.length > 0
        ? supabase
            .from('user_profiles')
            .select('user_id, email, first_name, last_name')
            .in('user_id', userIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from('ticket_audit_log')
        .select('ticket_id, action, details, created_at')
        .in('ticket_id', ticketIds)
        .eq('action', 'automated_evidence_gathered')
        .order('created_at', { ascending: false }),
      supabase
        .from('ticket_audit_log')
        .select('ticket_id, action, details, created_at')
        .in('ticket_id', ticketIds)
        .in('action', ['evidence_email_sent', 'evidence_submitted', 'user_evidence_received'])
        .order('created_at', { ascending: false }),
      supabase
        .from('ticket_foia_requests')
        .select('ticket_id, status, sent_at, requested_at')
        .in('ticket_id', ticketIds)
        .eq('request_type', 'ticket_evidence_packet'),
    ]);

    // Build maps
    const letterMap: Record<string, any> = {};
    for (const letter of (lettersResult.data || [])) {
      letterMap[letter.ticket_id] = letter;
    }

    const userMap: Record<string, any> = {};
    for (const user of (usersResult.data || [])) {
      userMap[user.user_id] = user;
    }

    const auditMap: Record<string, any> = {};
    for (const audit of (auditResult.data || [])) {
      if (!auditMap[audit.ticket_id]) {
        auditMap[audit.ticket_id] = audit; // take latest
      }
    }

    // Build FOIA request map
    const foiaMap: Record<string, any> = {};
    for (const foia of (foiaResult.data || [])) {
      if (!foiaMap[foia.ticket_id]) {
        const sentDate = foia.sent_at ? new Date(foia.sent_at) : null;
        const daysElapsed = sentDate ? Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
        const businessDaysElapsed = sentDate ? countBusinessDays(sentDate, new Date()) : 0;
        foiaMap[foia.ticket_id] = {
          status: foia.status,
          sent_at: foia.sent_at,
          requested_at: foia.requested_at,
          days_elapsed: daysElapsed,
          business_days_elapsed: businessDaysElapsed,
          deadline_expired: businessDaysElapsed >= 5,
          prima_facie_eligible: businessDaysElapsed >= 5 && (foia.status === 'sent' || foia.status === 'no_response'),
        };
      }
    }

    // Build email/evidence audit maps per ticket
    const emailSentMap: Record<string, any> = {};
    const evidenceReceivedMap: Record<string, any> = {};
    for (const audit of (emailAuditResult.data || [])) {
      if (audit.action === 'evidence_email_sent' && !emailSentMap[audit.ticket_id]) {
        emailSentMap[audit.ticket_id] = audit;
      }
      if ((audit.action === 'evidence_submitted' || audit.action === 'user_evidence_received') && !evidenceReceivedMap[audit.ticket_id]) {
        evidenceReceivedMap[audit.ticket_id] = audit;
      }
    }

    // Build pipeline items
    const pipelineItems = tickets.map(ticket => {
      const letter = letterMap[ticket.id];
      const user = userMap[ticket.user_id];
      const audit = auditMap[ticket.id];
      const foia = foiaMap[ticket.id] || null;
      const emailSentAudit = emailSentMap[ticket.id];
      const evidenceReceivedAudit = evidenceReceivedMap[ticket.id];
      let violationType = ticket.violation_type || normalizeViolationType(ticket.violation_description);

      // If still unknown, try to infer from defense_type
      if (violationType === 'other_unknown' && letter?.defense_type) {
        violationType = inferViolationFromDefense(letter.defense_type) || violationType;
      }

      // Parse evidence from audit log + letter-level evidence fields
      const evidenceDetails = audit?.details || {};
      const evidenceSources = buildEvidenceSources(evidenceDetails, letter);

      // Compute stage
      const stageInfo = computeStage(ticket, letter);

      // Compute evidence count
      const evidenceCount = evidenceSources.filter(e => e.found).length;
      const totalPossible = evidenceSources.length;

      // Extract user name: profile > letter content > fallback
      let userName = user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : null;
      let userEmail = user?.email || null;
      if (!userName && letter?.letter_content) {
        userName = extractNameFromLetter(letter.letter_content);
      }

      // Compute mail-by deadline (21 days from violation date = legal deadline)
      let mailByDeadline: string | null = null;
      let daysUntilDeadline: number | null = null;
      if (ticket.violation_date) {
        const vDate = new Date(ticket.violation_date);
        const deadline = new Date(vDate.getTime() + 21 * 24 * 60 * 60 * 1000);
        mailByDeadline = deadline.toISOString();
        daysUntilDeadline = Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      }

      // Evidence email tracking
      // Primary source: evidence_requested_at on ticket (always set when email is sent)
      // Fallback: audit log entry
      const emailSentAt = ticket.evidence_requested_at || emailSentAudit?.created_at || null;

      // Evidence reply tracking
      // Primary: evidence_received_at on ticket (set when user replies)
      // Fallback: user_evidence field populated, or audit log entry
      const evidenceReceivedAt = ticket.evidence_received_at || evidenceReceivedAudit?.created_at || null;
      const hasEvidenceReply = !!(evidenceReceivedAt || ticket.user_evidence || ticket.status === 'evidence_received');

      return {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        plate: ticket.plate,
        state: ticket.state,
        violation_date: ticket.violation_date,
        violation_description: ticket.violation_description || ticket.violation_code,
        violation_type: violationType,
        amount: ticket.amount,
        created_at: ticket.created_at,
        evidence_deadline: ticket.evidence_deadline,
        source: ticket.source,
        // User
        user_email: userEmail,
        user_name: userName,
        // Stage
        stage: stageInfo.stage,
        stage_label: stageInfo.label,
        stage_color: stageInfo.color,
        // Letter
        letter_id: letter?.id || null,
        letter_status: letter?.status || null,
        defense_type: letter?.defense_type || null,
        has_letter: !!letter,
        letter_has_content: !!(letter?.letter_content || letter?.letter_text),
        // Mailing
        mailed_at: letter?.mailed_at || null,
        lob_status: letter?.lob_status || null,
        lob_expected_delivery: letter?.lob_expected_delivery || null,
        // Deadlines
        mail_by_deadline: mailByDeadline,
        days_until_deadline: daysUntilDeadline,
        auto_send_deadline: ticket.auto_send_deadline || null,
        // Email & evidence tracking
        email_sent_at: emailSentAt,
        evidence_received_at: evidenceReceivedAt,
        has_evidence_reply: hasEvidenceReply,
        // Evidence summary
        evidence_count: evidenceCount,
        evidence_total: totalPossible,
        evidence_sources: evidenceSources,
        has_user_evidence: !!ticket.user_evidence,
        // Win rate
        base_win_rate: VIOLATION_WIN_RATES[violationType] || null,
        // FOIA evidence request tracking
        foia_request: foia,
      };
    });

    // Filter by stage if requested
    let filtered = pipelineItems;
    if (stage && stage !== 'all') {
      filtered = pipelineItems.filter(item => item.stage === stage);
    }

    // Compute aggregate stats
    const stats = {
      total: pipelineItems.length,
      by_stage: {
        detected: pipelineItems.filter(i => i.stage === 'detected').length,
        evidence_gathering: pipelineItems.filter(i => i.stage === 'evidence_gathering').length,
        letter_ready: pipelineItems.filter(i => i.stage === 'letter_ready').length,
        mailed: pipelineItems.filter(i => i.stage === 'mailed').length,
        delivered: pipelineItems.filter(i => i.stage === 'delivered').length,
      },
      by_violation: Object.entries(
        pipelineItems.reduce((acc: Record<string, number>, item) => {
          const key = item.violation_type || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]),
      avg_evidence_count: pipelineItems.length > 0
        ? Math.round((pipelineItems.reduce((sum, i) => sum + i.evidence_count, 0) / pipelineItems.length) * 10) / 10
        : 0,
      evidence_coverage: Object.entries(EVIDENCE_SOURCE_LABELS).map(([key, meta]) => ({
        key,
        label: meta.label,
        count: pipelineItems.filter(i => i.evidence_sources.some(e => e.key === key && e.found)).length,
        percent: pipelineItems.length > 0
          ? Math.round((pipelineItems.filter(i => i.evidence_sources.some(e => e.key === key && e.found)).length / pipelineItems.length) * 100)
          : 0,
      })).filter(e => e.count > 0).sort((a, b) => b.count - a.count),
    };

    return res.status(200).json({ success: true, tickets: filtered, stats });
  } catch (error: any) {
    console.error('Contest pipeline error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}

/** Get full detail for a single ticket including letter content and all evidence */
async function getTicketDetail(ticketId: string, res: NextApiResponse) {
  const [ticketResult, letterResult, auditResult] = await Promise.all([
    supabase
      .from('detected_tickets')
      .select('*')
      .eq('id', ticketId)
      .single(),
    supabase
      .from('contest_letters')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('ticket_audit_log')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: false }),
  ]);

  if (ticketResult.error) {
    return res.status(404).json({ error: 'Ticket not found' });
  }

  const ticket = ticketResult.data;
  const letter = letterResult.data?.[0] || null;
  const auditLogs = auditResult.data || [];

  // Get user profile
  let user = null;
  if (ticket.user_id) {
    const { data } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, mailing_address, foia_wait_preference')
      .eq('user_id', ticket.user_id)
      .single();
    user = data;
  }

  // Get FOIA evidence request for this ticket
  let foiaRequest = null;
  const { data: foiaData } = await supabase
    .from('ticket_foia_requests')
    .select('id, status, sent_at, requested_at, notes, response_payload, updated_at')
    .eq('ticket_id', ticketId)
    .eq('request_type', 'ticket_evidence_packet')
    .limit(1);
  if (foiaData && foiaData.length > 0) {
    const req = foiaData[0];
    const sentDate = req.sent_at ? new Date(req.sent_at) : null;
    const daysElapsed = sentDate ? Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
    const businessDaysElapsed = sentDate ? countBusinessDays(sentDate, new Date()) : 0;
    const deadlineExpired = businessDaysElapsed >= 5;
    const deadlineDate = sentDate ? addBusinessDays(sentDate, 5) : null;
    foiaRequest = {
      id: req.id,
      status: req.status,
      sent_at: req.sent_at,
      requested_at: req.requested_at,
      updated_at: req.updated_at,
      days_elapsed: daysElapsed,
      business_days_elapsed: businessDaysElapsed,
      deadline_expired: deadlineExpired,
      deadline_date: deadlineDate?.toISOString() || null,
      prima_facie_eligible: deadlineExpired && (req.status === 'sent' || req.status === 'no_response'),
      response_received: req.status === 'fulfilled' || req.status === 'partial_response',
      notes: req.notes,
      resend_email_id: req.response_payload?.resend_email_id || null,
    };
  }

  // Fallback: extract name from letter content if profile is empty
  let userName = user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : null;
  if (!userName && letter?.letter_content) {
    userName = extractNameFromLetter(letter.letter_content);
  }

  // Extract evidence details from audit log
  const evidenceAudit = auditLogs.find(a => a.action === 'automated_evidence_gathered');
  const evidenceDetails = evidenceAudit?.details || {};

  // Also check ticket_contests for kit evaluation data
  let contestData = null;
  if (ticket.ticket_number) {
    const { data } = await supabase
      .from('ticket_contests')
      .select('*')
      .eq('ticket_number', ticket.ticket_number)
      .limit(1);
    contestData = data?.[0] || null;
  }

  // Extract email sent data from audit logs
  const emailSentLog = auditLogs.find(a => a.action === 'evidence_email_sent');
  const emailInfo = emailSentLog ? {
    sent_at: emailSentLog.created_at,
    details: emailSentLog.details || {},
  } : null;

  // Extract camera check data from automated evidence for dedicated display
  const cameraCheckData = evidenceDetails.cameraCheck || null;

  return res.status(200).json({
    success: true,
    ticket,
    letter,
    user: {
      email: user?.email || null,
      name: userName,
      has_mailing_address: !!user?.mailing_address,
    },
    evidence: {
      automated: evidenceDetails,
      user_submitted: ticket.user_evidence,
      sources: buildEvidenceSources(evidenceDetails, letter),
    },
    camera_check: cameraCheckData,
    foia_request: foiaRequest,
    foia_wait_preference: user?.foia_wait_preference || 'wait_for_foia',
    email_info: emailInfo,
    contest: contestData ? {
      kit_used: contestData.kit_used,
      argument_used: contestData.argument_used,
      weather_defense_used: contestData.weather_defense_used,
      estimated_win_rate: contestData.estimated_win_rate,
      street_view_exhibit_urls: contestData.street_view_exhibit_urls,
      street_view_date: contestData.street_view_date,
      evidence_checklist: contestData.evidence_checklist,
    } : null,
    audit_log: auditLogs.map(a => ({
      action: a.action,
      details: a.details,
      created_at: a.created_at,
      performed_by: a.performed_by,
    })),
  });
}

function buildEvidenceSources(details: any, letter?: any) {
  // Check letter content for evidence keywords — the AI letters always reference
  // the evidence sources used, even if evidence_integrated flag isn't set.
  // evidence_integrated only means "user evidence was merged after generation".
  const letterContent = letter?.letter_content || letter?.letter_text || '';
  const hasLetter = !!letterContent;
  const letterDefense = letter?.defense_type || '';

  const sources = [
    {
      key: 'contest_kit',
      ...EVIDENCE_SOURCE_LABELS['contest_kit'],
      found: !!letterDefense,
      data: letterDefense ? { defense_type: letterDefense } : null,
    },
    {
      key: 'foia_data',
      ...EVIDENCE_SOURCE_LABELS['foia_data'],
      found: !!details.foiaWinRate?.totalContested || (hasLetter && /FOIA|hearing outcome|administrative hearing|contest.*rate|success rate|dismissal rate|\d+%.*dismissed|dismissed.*\d+%/i.test(letterContent)),
      data: details.foiaWinRate || null,
    },
    {
      key: 'weather',
      ...EVIDENCE_SOURCE_LABELS['weather'],
      found: !!details.weather?.summary || (hasLetter && /weather.*condition|rain.*day|snow.*day|storm|poor visibility|inclement weather|temperature.*degree/i.test(letterContent)),
      data: details.weather || null,
      defense_relevant: details.weather?.defenseRelevant || false,
    },
    {
      key: 'street_view',
      ...EVIDENCE_SOURCE_LABELS['street_view'],
      found: !!details.streetView?.hasImagery || !!(letter?.street_view_exhibit_urls && letter.street_view_exhibit_urls.length > 0) || (hasLetter && /street view|google.*street|exhibit.*photograph|attached.*photo/i.test(letterContent)),
      data: details.streetView || (letter?.street_view_exhibit_urls ? {
        urls: letter.street_view_exhibit_urls,
        date: letter.street_view_date,
        address: letter.street_view_address,
      } : null),
    },
    {
      key: 'street_view_ai_analysis',
      ...EVIDENCE_SOURCE_LABELS['street_view_ai_analysis'],
      found: !!details.streetViewAI || (hasLetter && /sign.*analysis|visibility.*analysis|signage.*condition|AI.*analysis|sign.*obstructed|sign.*obscured|sign.*not visible/i.test(letterContent)),
      data: details.streetViewAI || null,
    },
    {
      key: 'gps_parking',
      ...EVIDENCE_SOURCE_LABELS['gps_parking'],
      found: !!details.parkingHistory?.matchFound || (hasLetter && /GPS.*data|GPS.*record|parking.*data|departure.*time|arrival.*time|mobile.*app.*record/i.test(letterContent)),
      data: details.parkingHistory || null,
    },
    {
      key: 'registration',
      ...EVIDENCE_SOURCE_LABELS['registration'],
      found: hasLetter && /registration.*renew|renewed.*registration|registration.*receipt|renewed.*plate|proof.*renewal|valid.*registration/i.test(letterContent),
      data: null,
    },
    {
      key: 'city_sticker',
      ...EVIDENCE_SOURCE_LABELS['city_sticker'],
      found: hasLetter && /city.*sticker|wheel.*tax|sticker.*purchase|receipt.*sticker|vehicle.*sticker|sticker.*valid/i.test(letterContent),
      data: null,
    },
    {
      key: 'street_cleaning_schedule',
      ...EVIDENCE_SOURCE_LABELS['street_cleaning_schedule'],
      found: !!details.streetCleaning?.relevant || (hasLetter && /street.*clean.*schedule|sweep.*schedule|cleaning.*schedule|not.*scheduled.*clean/i.test(letterContent)),
      data: details.streetCleaning || null,
    },
    {
      key: 'court_data',
      ...EVIDENCE_SOURCE_LABELS['court_data'],
      found: !!details.courtData || (hasLetter && /court record|case.*similar|hearing data|adjudication.*record/i.test(letterContent)),
      data: details.courtData || null,
    },
    // Camera-specific checks
    {
      key: 'camera_school_zone',
      ...EVIDENCE_SOURCE_LABELS['camera_school_zone'],
      found: !!details.cameraCheck?.schoolZoneDefenseApplicable || details.cameraCheck?.isSchoolDay === false,
      data: details.cameraCheck ? {
        violationType: details.cameraCheck.violationType,
        isSchoolDay: details.cameraCheck.isSchoolDay,
        isWeekend: details.cameraCheck.isWeekend,
        isSummer: details.cameraCheck.isSummer,
        isCpsHoliday: details.cameraCheck.isCpsHoliday,
        defenseApplicable: details.cameraCheck.schoolZoneDefenseApplicable,
      } : null,
      defense_relevant: !!details.cameraCheck?.schoolZoneDefenseApplicable,
    },
    {
      key: 'camera_yellow_light',
      ...EVIDENCE_SOURCE_LABELS['camera_yellow_light'],
      found: details.cameraCheck?.violationType === 'red_light',
      data: details.cameraCheck?.violationType === 'red_light' ? {
        message: 'IDOT minimums: 3.0s at 30mph, 3.5s at 35mph, 4.0s at 40mph, 4.5s at 45mph',
      } : null,
    },
  ];

  return sources;
}

/** Extract sender name from letter content. Letters follow format: date line, then name on next non-empty line */
function extractNameFromLetter(letterContent: string): string | null {
  if (!letterContent) return null;
  const lines = letterContent.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Strategy 1: First line is a date, second line is the name
  // Date patterns: "January 4, 2026", "01/04/2026", "2026-01-04", "Feb 14, 2026"
  const datePattern = /^(?:january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}[\/\-])\s*\d/i;
  for (let i = 0; i < Math.min(lines.length - 1, 5); i++) {
    if (datePattern.test(lines[i])) {
      const nextLine = lines[i + 1];
      // Name line: 2-4 words, no numbers (not an address), not a city/org header
      if (nextLine && /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(nextLine) && !/\d/.test(nextLine) && !/city of|department|p\.o\.|box/i.test(nextLine)) {
        return nextLine;
      }
    }
  }

  // Strategy 2: Look for "Sincerely," followed by name
  const sincerelyIdx = lines.findIndex(l => /^sincerely|^respectfully|^regards/i.test(l));
  if (sincerelyIdx >= 0 && sincerelyIdx < lines.length - 1) {
    const nameLine = lines[sincerelyIdx + 1];
    if (nameLine && /^[A-Z][a-z]+\s+[A-Z][a-z]+/.test(nameLine) && !/\d/.test(nameLine)) {
      return nameLine;
    }
  }

  return null;
}

/** Map defense_type back to a violation type when violation_description is null */
function inferViolationFromDefense(defenseType: string): string | null {
  const map: Record<string, string> = {
    // Registration / plates
    'registration_renewed': 'expired_plates',
    'registration_renewal': 'expired_plates',
    'expired_registration': 'expired_plates',
    'plates_renewed': 'expired_plates',
    // City sticker
    'sticker_challenge': 'no_city_sticker',
    'city_sticker': 'no_city_sticker',
    'sticker_purchased': 'no_city_sticker',
    'wheel_tax': 'no_city_sticker',
    // Meter
    'meter_malfunction': 'expired_meter',
    'meter_expired': 'expired_meter',
    'meter_challenge': 'expired_meter',
    // Street cleaning
    'street_cleaning': 'street_cleaning',
    'street_cleaning_challenge': 'street_cleaning',
    'cleaning_schedule': 'street_cleaning',
    // Fire hydrant
    'fire_hydrant': 'fire_hydrant',
    'hydrant_distance': 'fire_hydrant',
    // Disabled
    'disabled_zone': 'disabled_zone',
    'handicap_permit': 'disabled_zone',
    // Red light / speed
    'red_light': 'red_light',
    'speed_camera': 'speed_camera',
    // Missing plate
    'missing_plate': 'missing_plate',
    // Residential permit
    'residential_permit': 'residential_permit',
    // Snow route
    'snow_route': 'snow_route',
    // Double parking
    'double_parking': 'double_parking',
    // Loading zone
    'commercial_loading': 'commercial_loading',
    'loading_zone': 'commercial_loading',
    // Bike lane
    'bike_lane': 'bike_lane',
    // Bus stop/lane
    'bus_stop': 'bus_stop',
    'bus_lane': 'bus_lane',
    // Generic
    'signage_challenge': 'no_standing_time_restricted',
    'sign_obstruction': 'no_standing_time_restricted',
  };
  return map[defenseType] || null;
}

function computeStage(ticket: any, letter: any): { stage: string; label: string; color: string } {
  if (letter?.lob_status === 'delivered' || letter?.mailed_at) {
    if (letter?.lob_status === 'delivered') {
      return { stage: 'delivered', label: 'Delivered to City Hall', color: '#059669' };
    }
    return { stage: 'mailed', label: 'Mailed via Lob', color: '#2563EB' };
  }

  if (letter?.evidence_integrated || (letter?.letter_content && ticket.user_evidence)) {
    return { stage: 'letter_ready', label: 'Letter Ready (Evidence Integrated)', color: '#7C3AED' };
  }

  if (letter?.letter_content) {
    return { stage: 'letter_ready', label: 'Letter Generated', color: '#6366F1' };
  }

  if (ticket.status === 'pending_evidence') {
    return { stage: 'evidence_gathering', label: 'Awaiting User Evidence', color: '#F59E0B' };
  }

  return { stage: 'detected', label: 'Ticket Detected', color: '#6B7280' };
}

function normalizeViolationType(description: string | null): string {
  if (!description) return 'other_unknown';
  const desc = description.toLowerCase();
  const MAP: Record<string, string> = {
    'expired plates': 'expired_plates', 'expired registration': 'expired_plates',
    'no city sticker': 'no_city_sticker', 'city sticker': 'no_city_sticker', 'wheel tax': 'no_city_sticker',
    'expired meter': 'expired_meter', 'parking meter': 'expired_meter', 'overtime': 'expired_meter',
    'street cleaning': 'street_cleaning', 'street sweeping': 'street_cleaning',
    'fire hydrant': 'fire_hydrant',
    'disabled': 'disabled_zone', 'handicap': 'disabled_zone',
    'red light': 'red_light', 'speed camera': 'speed_camera',
    'missing plate': 'missing_plate', 'no front plate': 'missing_plate',
    'bus lane': 'bus_lane', 'residential permit': 'residential_permit',
    'snow route': 'snow_route', 'double park': 'double_parking',
    'loading zone': 'commercial_loading', 'bike lane': 'bike_lane',
    'bus stop': 'bus_stop', 'no standing': 'no_standing_time_restricted',
    'no parking': 'parking_prohibited', 'parking prohibited': 'parking_prohibited',
    'alley': 'parking_alley',
  };
  for (const [key, value] of Object.entries(MAP)) {
    if (desc.includes(key)) return value;
  }
  return 'other_unknown';
}

function getEmptyStats() {
  return {
    total: 0,
    by_stage: { detected: 0, evidence_gathering: 0, letter_ready: 0, mailed: 0, delivered: 0 },
    by_violation: [],
    avg_evidence_count: 0,
    evidence_coverage: [],
  };
}

/** Count business days (Mon-Fri) between two dates */
function countBusinessDays(start: Date, end: Date): number {
  let count = 0;
  const current = new Date(start);
  current.setDate(current.getDate() + 1); // Start counting from next day
  while (current <= end) {
    const day = current.getDay();
    if (day !== 0 && day !== 6) count++;
    current.setDate(current.getDate() + 1);
  }
  return count;
}

/** Add N business days to a date */
function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
}
