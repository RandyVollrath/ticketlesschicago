/**
 * Admin API: FOIA Tracker
 *
 * GET  — Fetch all FOIA requests (evidence + history) with related ticket, user, and letter data
 * PATCH — Update a FOIA request's status or notes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ADMIN_EMAILS = [
  'randy@autopilotamerica.com',
  'admin@autopilotamerica.com',
  'randyvollrath@gmail.com',
  'carenvollrath@gmail.com',
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Auth: verify Supabase session belongs to an admin
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

  if (authError || !user || !ADMIN_EMAILS.includes(user.email || '')) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'PATCH') {
    return handlePatch(req, res);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  const limit = parseInt(req.query.limit as string) || 200;

  try {
    // ── 1. Fetch evidence FOIAs ──
    const { data: evidenceRaw, error: evErr } = await supabaseAdmin
      .from('ticket_foia_requests' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (evErr) console.error('Evidence FOIA fetch error:', evErr.message);
    const evidenceFoias = (evidenceRaw || []) as any[];

    // Batch-fetch related tickets, letters, users
    const ticketIds = [...new Set(evidenceFoias.map(f => f.ticket_id).filter(Boolean))];
    const letterIds = [...new Set(evidenceFoias.map(f => f.contest_letter_id).filter(Boolean))];
    const allUserIds = [...new Set([
      ...evidenceFoias.map(f => f.user_id),
    ].filter(Boolean))];

    const [ticketsRes, lettersRes] = await Promise.all([
      ticketIds.length > 0
        ? supabaseAdmin.from('detected_tickets' as any)
            .select('id, ticket_number, violation_type, violation_date, violation_location, fine_amount, license_plate, license_state')
            .in('id', ticketIds)
        : Promise.resolve({ data: [] }),
      letterIds.length > 0
        ? supabaseAdmin.from('contest_letters' as any)
            .select('id, letter_text, letter_content, status, defense_type, evidence_integrated, evidence_integrated_at, mailed_at, approved_via, created_at')
            .in('id', letterIds)
        : Promise.resolve({ data: [] }),
    ]);

    const ticketMap: Record<string, any> = {};
    for (const t of (ticketsRes.data || []) as any[]) ticketMap[t.id] = t;

    const letterMap: Record<string, any> = {};
    for (const l of (lettersRes.data || []) as any[]) letterMap[l.id] = l;

    // ── 2. Fetch history FOIAs ──
    const { data: historyRaw, error: hErr } = await supabaseAdmin
      .from('foia_history_requests' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (hErr) console.error('History FOIA fetch error:', hErr.message);
    const historyFoias = (historyRaw || []) as any[];

    // Collect all user IDs from both tables
    const historyUserIds = historyFoias.map(f => f.user_id).filter(Boolean);
    const combinedUserIds = [...new Set([...allUserIds, ...historyUserIds])];

    const usersRes = combinedUserIds.length > 0
      ? await supabaseAdmin.from('user_profiles' as any)
          .select('user_id, email, full_name, license_plate, license_state')
          .in('user_id', combinedUserIds)
      : { data: [] };

    const userMap: Record<string, any> = {};
    for (const u of (usersRes.data || []) as any[]) userMap[u.user_id] = u;

    // ── 3. Enrich evidence FOIAs ──
    const enrichedEvidence = evidenceFoias.map(f => {
      const ticket = ticketMap[f.ticket_id] || null;
      const letter = f.contest_letter_id ? (letterMap[f.contest_letter_id] || null) : null;
      const userProfile = userMap[f.user_id] || null;

      // Determine departments (DOF always, CDOT for camera violations)
      const departments = ['DOF'];
      if (f.response_payload?.cdot_sent || f.response_payload?.cdot_email_id) {
        departments.push('CDOT');
      }

      return {
        id: f.id,
        foia_type: 'evidence' as const,
        status: f.status,
        reference_id: f.reference_id,
        resend_message_id: f.resend_message_id,
        request_type: f.request_type,
        notes: f.notes,
        created_at: f.created_at,
        sent_at: f.sent_at,
        fulfilled_at: f.fulfilled_at,
        updated_at: f.updated_at,
        request_payload: f.request_payload,
        response_payload: f.response_payload,
        departments,
        // Related data
        ticket: ticket ? {
          ticket_number: ticket.ticket_number,
          violation_type: ticket.violation_type,
          violation_date: ticket.violation_date,
          violation_location: ticket.violation_location,
          fine_amount: ticket.fine_amount,
          license_plate: ticket.license_plate,
          license_state: ticket.license_state,
        } : null,
        contest_letter: letter ? {
          id: letter.id,
          status: letter.status,
          defense_type: letter.defense_type,
          evidence_integrated: letter.evidence_integrated,
          evidence_integrated_at: letter.evidence_integrated_at,
          mailed_at: letter.mailed_at,
          approved_via: letter.approved_via,
          letter_text: letter.letter_text || letter.letter_content || null,
          created_at: letter.created_at,
        } : null,
        user: userProfile ? {
          email: userProfile.email,
          name: userProfile.full_name,
          license_plate: userProfile.license_plate,
          license_state: userProfile.license_state,
        } : null,
      };
    });

    // ── 4. Enrich history FOIAs ──
    const enrichedHistory = historyFoias.map(f => {
      const userProfile = f.user_id ? (userMap[f.user_id] || null) : null;

      return {
        id: f.id,
        foia_type: 'history' as const,
        status: f.status,
        reference_id: f.reference_id,
        resend_message_id: f.resend_message_id,
        notes: f.notes,
        created_at: f.created_at,
        sent_at: f.foia_sent_at,
        fulfilled_at: f.response_received_at,
        updated_at: f.updated_at,
        departments: ['DOF'],
        // History-specific
        license_plate: f.license_plate,
        license_state: f.license_state,
        email: f.email,
        name: f.name,
        source: f.source,
        ticket_count: f.ticket_count,
        total_fines: f.total_fines,
        consent_given: f.consent_given,
        consent_given_at: f.consent_given_at,
        signature_name: f.signature_name,
        // Related data
        ticket: null,
        contest_letter: null,
        user: userProfile ? {
          email: userProfile.email,
          name: userProfile.full_name,
          license_plate: userProfile.license_plate,
          license_state: userProfile.license_state,
        } : (f.email ? {
          email: f.email,
          name: f.name,
          license_plate: f.license_plate,
          license_state: f.license_state,
        } : null),
      };
    });

    // ── 5. Fetch unmatched responses ──
    const { data: unmatchedRaw } = await supabaseAdmin
      .from('foia_unmatched_responses' as any)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    // ── 6. Compute stats ──
    const allFoias = [...enrichedEvidence, ...enrichedHistory];
    const stats = {
      total: allFoias.length,
      evidence: enrichedEvidence.length,
      history: enrichedHistory.length,
      byStatus: {} as Record<string, number>,
      unmatched: (unmatchedRaw || []).filter((r: any) => r.status === 'pending').length,
    };
    for (const f of allFoias) {
      stats.byStatus[f.status] = (stats.byStatus[f.status] || 0) + 1;
    }

    return res.status(200).json({
      stats,
      evidence: enrichedEvidence,
      history: enrichedHistory,
      unmatched: unmatchedRaw || [],
    });
  } catch (err: any) {
    console.error('FOIA tracker error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function handlePatch(req: NextApiRequest, res: NextApiResponse) {
  const { table, id, status, notes } = req.body;

  if (!table || !id) {
    return res.status(400).json({ error: 'Missing table or id' });
  }

  const tableName = table === 'evidence' ? 'ticket_foia_requests' : 'foia_history_requests';

  const updatePayload: any = { updated_at: new Date().toISOString() };
  if (status) updatePayload.status = status;
  if (notes !== undefined) updatePayload.notes = notes;

  // Set fulfilled timestamps
  if (status === 'fulfilled' || status === 'fulfilled_with_records' || status === 'fulfilled_denial') {
    if (table === 'evidence') {
      updatePayload.fulfilled_at = new Date().toISOString();
    } else {
      updatePayload.response_received_at = new Date().toISOString();
    }
  }

  try {
    const { error } = await supabaseAdmin
      .from(tableName as any)
      .update(updatePayload)
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
