import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Ticket Pipeline API
 *
 * Returns tickets with their lifecycle stage:
 * 1. Ticket Detected (via VA upload)
 * 2. Letter Generated (without evidence)
 * 3. Evidence Letter Generated (AI-enhanced)
 * 4. Letter Sent to City Hall (via Lob)
 */

export interface TicketPipelineItem {
  id: string;
  ticket_number: string;
  ticket_status: string;
  user_email: string;
  user_name: string | null;
  violation_description: string | null;
  ticket_amount: number | null;
  created_at: string;
  // Letter info
  letter_id: string | null;
  letter_status: string | null;
  has_evidence: boolean;
  evidence_integrated: boolean;
  evidence_integrated_at: string | null;
  mailed_at: string | null;
  lob_status: string | null;
  lob_expected_delivery: string | null;
  // Computed stage
  stage: 'ticket_detected' | 'letter_generated' | 'evidence_letter_generated' | 'letter_sent';
  stage_label: string;
}

function computeStage(item: any): { stage: string; stage_label: string } {
  // If mailed, it's sent
  if (item.mailed_at || item.lob_status) {
    return { stage: 'letter_sent', stage_label: 'Letter Sent to City Hall' };
  }

  // If evidence integrated, it's evidence letter
  if (item.evidence_integrated) {
    return { stage: 'evidence_letter_generated', stage_label: 'Evidence Letter Generated' };
  }

  // If letter exists but no evidence, it's basic letter
  if (item.letter_id) {
    return { stage: 'letter_generated', stage_label: 'Letter Generated (No Evidence)' };
  }

  // Otherwise, just detected
  return { stage: 'ticket_detected', stage_label: 'Ticket Detected' };
}

export default withAdminAuth(async (req, res, adminUser) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { stage, limit = '50' } = req.query;

    // Query tickets with letter info
    const { data: tickets, error } = await supabase
      .from('detected_tickets')
      .select(`
        id,
        ticket_number,
        status,
        violation_description,
        amount,
        user_evidence,
        created_at,
        user_id
      `)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit as string));

    if (error) {
      console.error('Ticket fetch error:', error);
      return res.status(500).json({ error: sanitizeErrorMessage(error) });
    }

    if (!tickets || tickets.length === 0) {
      return res.status(200).json({
        success: true,
        tickets: [],
        stats: { total: 0, ticket_detected: 0, letter_generated: 0, evidence_letter_generated: 0, letter_sent: 0 }
      });
    }

    // Get letters for these tickets
    const ticketIds = tickets.map(t => t.id);
    const { data: letters } = await supabase
      .from('contest_letters')
      .select(`
        id,
        ticket_id,
        status,
        evidence_integrated,
        evidence_integrated_at,
        mailed_at,
        lob_status,
        lob_expected_delivery,
        letter_content,
        defense_type
      `)
      .in('ticket_id', ticketIds);

    // Map letters by ticket_id
    const letterMap: Record<string, any> = {};
    if (letters) {
      for (const letter of letters) {
        letterMap[letter.ticket_id] = letter;
      }
    }

    // Get user emails
    const userIds = [...new Set(tickets.map(t => t.user_id).filter(Boolean))];
    let userMap: Record<string, { email: string; first_name?: string; last_name?: string }> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('user_id, email')
        .in('user_id', userIds);

      if (profiles) {
        for (const p of profiles) {
          userMap[p.user_id] = { email: p.email };
        }
      }

      // Also get autopilot profiles for names
      const { data: autopilotProfiles } = await supabase
        .from('autopilot_profiles')
        .select('user_id, first_name, last_name')
        .in('user_id', userIds);

      if (autopilotProfiles) {
        for (const ap of autopilotProfiles) {
          if (userMap[ap.user_id]) {
            userMap[ap.user_id].first_name = ap.first_name;
            userMap[ap.user_id].last_name = ap.last_name;
          }
        }
      }
    }

    // Build pipeline items
    const pipelineItems: TicketPipelineItem[] = tickets.map(ticket => {
      const letter = letterMap[ticket.id];
      const user = userMap[ticket.user_id] || { email: 'Unknown' };
      const hasEvidence = !!ticket.user_evidence;

      const item = {
        id: ticket.id,
        ticket_number: ticket.ticket_number,
        ticket_status: ticket.status,
        user_email: user.email,
        user_name: user.first_name && user.last_name
          ? `${user.first_name} ${user.last_name}`
          : user.first_name || null,
        violation_description: ticket.violation_description,
        ticket_amount: ticket.amount,
        created_at: ticket.created_at,
        letter_id: letter?.id || null,
        letter_status: letter?.status || null,
        letter_content: letter?.letter_content || null,
        defense_type: letter?.defense_type || null,
        has_evidence: hasEvidence,
        evidence_integrated: letter?.evidence_integrated || false,
        evidence_integrated_at: letter?.evidence_integrated_at || null,
        mailed_at: letter?.mailed_at || null,
        lob_status: letter?.lob_status || null,
        lob_expected_delivery: letter?.lob_expected_delivery || null,
        stage: '' as any,
        stage_label: '',
      };

      const stageInfo = computeStage(item);
      item.stage = stageInfo.stage as any;
      item.stage_label = stageInfo.stage_label;

      return item;
    });

    // Filter by stage if requested
    let filteredItems = pipelineItems;
    if (stage && stage !== 'all') {
      filteredItems = pipelineItems.filter(item => item.stage === stage);
    }

    // Compute stats
    const stats = {
      total: pipelineItems.length,
      ticket_detected: pipelineItems.filter(i => i.stage === 'ticket_detected').length,
      letter_generated: pipelineItems.filter(i => i.stage === 'letter_generated').length,
      evidence_letter_generated: pipelineItems.filter(i => i.stage === 'evidence_letter_generated').length,
      letter_sent: pipelineItems.filter(i => i.stage === 'letter_sent').length,
    };

    return res.status(200).json({
      success: true,
      tickets: filteredItems,
      stats,
    });

  } catch (error: any) {
    console.error('Ticket pipeline error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
