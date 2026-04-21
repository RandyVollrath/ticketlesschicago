import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/auth-middleware';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default withAdminAuth(async (req, res, adminUser) => {
  try {
    if (req.method === 'GET' && req.query.id) {
      // Get single letter with full text
      const { id } = req.query;

      const { data: letter, error } = await supabase
        .from('contest_letters')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error || !letter) {
        return res.status(404).json({ error: 'Letter not found' });
      }

      return res.status(200).json({ success: true, letter });

    } else if (req.method === 'GET') {
      // List all contest letters
      const { status, evidence_integrated, limit: limitStr = '50', offset: offsetStr = '0' } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limitStr as string) || 50, 1), 200);
      const parsedOffset = Math.max(parseInt(offsetStr as string) || 0, 0);

      let query = supabase
        .from('contest_letters')
        .select(`
          id,
          ticket_id,
          user_id,
          letter_text,
          letter_pdf_url,
          status,
          lob_letter_id,
          lob_status,
          lob_expected_delivery,
          delivery_status,
          expected_delivery_date,
          delivered_at,
          returned_at,
          failed_at,
          last_tracking_update,
          defense_type,
          evidence_integrated,
          evidence_integrated_at,
          mailed_at,
          disposition,
          disposition_reason,
          disposition_date,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false })
        .range(parsedOffset, parsedOffset + parsedLimit - 1);

      if (status) {
        query = query.eq('status', status);
      }

      if (evidence_integrated === 'true') {
        query = query.eq('evidence_integrated', true);
      } else if (evidence_integrated === 'false') {
        query = query.eq('evidence_integrated', false);
      }

      const { data: letters, error: fetchError } = await query;

      if (fetchError) {
        console.error('Fetch error:', fetchError);
        return res.status(500).json({ error: sanitizeErrorMessage(fetchError) });
      }

      // Get user emails for each letter
      const userIds = [...new Set(letters?.map(l => l.user_id).filter(Boolean))];
      let userMap: Record<string, string> = {};

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('user_id, email')
          .in('user_id', userIds);

        if (profiles) {
          userMap = profiles.reduce((acc, p) => {
            acc[p.user_id] = p.email;
            return acc;
          }, {} as Record<string, string>);
        }
      }

      // Get ticket info for each letter
      const ticketIds = [...new Set(letters?.map(l => l.ticket_id).filter(Boolean))];
      let ticketMap: Record<string, any> = {};

      if (ticketIds.length > 0) {
        const { data: tickets } = await supabase
          .from('ticket_contests')
          .select('id, ticket_number, violation_code, violation_description, ticket_amount, ticket_location')
          .in('id', ticketIds);

        if (tickets) {
          ticketMap = tickets.reduce((acc, t) => {
            acc[t.id] = t;
            return acc;
          }, {} as Record<string, any>);
        }
      }

      // Get red-light receipt info for each user (for letters with red-light violations)
      let redLightMap: Record<string, any> = {};
      if (userIds.length > 0) {
        const { data: receipts } = await supabase
          .from('red_light_receipts')
          .select('id, user_id, device_timestamp, camera_address, full_stop_detected, full_stop_duration_sec, approach_speed_mph, min_speed_mph, speed_delta_mph, evidence_hash')
          .in('user_id', userIds)
          .order('created_at', { ascending: false })
          .limit(500);

        if (receipts) {
          // Group by user_id, keep latest per user
          for (const r of receipts) {
            if (!redLightMap[r.user_id]) {
              redLightMap[r.user_id] = r;
            }
          }
        }
      }

      // Enrich letters with user and ticket info
      const enrichedLetters = letters?.map(letter => {
        const ticketInfo = ticketMap[letter.ticket_id] || null;
        const violationDesc = (ticketInfo?.violation_description || '').toLowerCase();
        const isRedLight = violationDesc.includes('red light');
        const redLightReceipt = isRedLight ? redLightMap[letter.user_id] || null : null;

        return {
          ...letter,
          user_email: userMap[letter.user_id] || null,
          ticket_info: ticketInfo,
          red_light_evidence: redLightReceipt ? {
            receipt_id: redLightReceipt.id,
            camera_address: redLightReceipt.camera_address,
            full_stop_detected: redLightReceipt.full_stop_detected,
            full_stop_duration_sec: redLightReceipt.full_stop_duration_sec,
            approach_speed_mph: redLightReceipt.approach_speed_mph,
            min_speed_mph: redLightReceipt.min_speed_mph,
            speed_delta_mph: redLightReceipt.speed_delta_mph,
            has_evidence_hash: !!redLightReceipt.evidence_hash,
            device_timestamp: redLightReceipt.device_timestamp,
          } : null,
        };
      });

      // Get total count (apply same filters as data query)
      let countQuery = supabase
        .from('contest_letters')
        .select('*', { count: 'exact', head: true });

      if (status) {
        countQuery = countQuery.eq('status', status);
      }
      if (evidence_integrated === 'true') {
        countQuery = countQuery.eq('evidence_integrated', true);
      } else if (evidence_integrated === 'false') {
        countQuery = countQuery.eq('evidence_integrated', false);
      }

      const { count: totalCount } = await countQuery;

      res.status(200).json({
        success: true,
        letters: enrichedLetters || [],
        pagination: {
          limit: parsedLimit,
          offset: parsedOffset,
          total: totalCount || 0
        }
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error: any) {
    console.error('Admin contest letters error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
