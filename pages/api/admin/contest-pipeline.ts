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

    const [lettersResult, usersResult, auditResult] = await Promise.all([
      supabase
        .from('contest_letters')
        .select(`
          id, ticket_id, status, defense_type, letter_content, letter_text,
          evidence_integrated, evidence_integrated_at,
          mailed_at, lob_status, lob_expected_delivery, lob_letter_id,
          using_default_address, created_at
        `)
        .in('ticket_id', ticketIds),
      userIds.length > 0
        ? supabase
            .from('user_profiles')
            .select('user_id, email, first_name, last_name, full_name')
            .in('user_id', userIds)
        : Promise.resolve({ data: [] }),
      supabase
        .from('ticket_audit_log')
        .select('ticket_id, action, details, created_at')
        .in('ticket_id', ticketIds)
        .eq('action', 'automated_evidence_gathered')
        .order('created_at', { ascending: false }),
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

    // Build pipeline items
    const pipelineItems = tickets.map(ticket => {
      const letter = letterMap[ticket.id];
      const user = userMap[ticket.user_id];
      const audit = auditMap[ticket.id];
      const violationType = ticket.violation_type || normalizeViolationType(ticket.violation_description);

      // Parse evidence from audit log
      const evidenceDetails = audit?.details || {};
      const evidenceSources = buildEvidenceSources(evidenceDetails);

      // Compute stage
      const stageInfo = computeStage(ticket, letter);

      // Compute evidence count
      const evidenceCount = evidenceSources.filter(e => e.found).length;
      const totalPossible = evidenceSources.length;

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
        user_email: user?.email || null,
        user_name: user?.full_name || (user?.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : null),
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
        // Evidence summary
        evidence_count: evidenceCount,
        evidence_total: totalPossible,
        evidence_sources: evidenceSources,
        has_user_evidence: !!ticket.user_evidence,
        // Win rate
        base_win_rate: VIOLATION_WIN_RATES[violationType] || null,
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
      .select('user_id, email, first_name, last_name, full_name, mailing_address')
      .eq('user_id', ticket.user_id)
      .single();
    user = data;
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

  return res.status(200).json({
    success: true,
    ticket,
    letter,
    user: user ? {
      email: user.email,
      name: user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      has_mailing_address: !!user.mailing_address,
    } : null,
    evidence: {
      automated: evidenceDetails,
      user_submitted: ticket.user_evidence,
      sources: buildEvidenceSources(evidenceDetails),
    },
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

function buildEvidenceSources(details: any) {
  const sources = [
    {
      key: 'weather',
      ...EVIDENCE_SOURCE_LABELS['weather'],
      found: !!details.weather?.summary,
      data: details.weather || null,
      defense_relevant: details.weather?.defenseRelevant || false,
    },
    {
      key: 'foia_data',
      ...EVIDENCE_SOURCE_LABELS['foia_data'],
      found: !!details.foiaWinRate?.totalContested,
      data: details.foiaWinRate || null,
    },
    {
      key: 'gps_parking',
      ...EVIDENCE_SOURCE_LABELS['gps_parking'],
      found: !!details.parkingHistory?.matchFound,
      data: details.parkingHistory || null,
    },
    {
      key: 'street_view',
      ...EVIDENCE_SOURCE_LABELS['street_view'],
      found: !!details.streetView?.hasImagery,
      data: details.streetView || null,
    },
    {
      key: 'street_cleaning_schedule',
      ...EVIDENCE_SOURCE_LABELS['street_cleaning_schedule'],
      found: !!details.streetCleaning?.relevant,
      data: details.streetCleaning || null,
    },
  ];

  // Only include applicable sources
  return sources;
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
