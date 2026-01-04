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
    if (req.method === 'GET') {
      // List all contest letters
      const { status, evidence_integrated, limit = '50', offset = '0' } = req.query;

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
          defense_type,
          evidence_integrated,
          evidence_integrated_at,
          mailed_at,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false })
        .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

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

      // Enrich letters with user and ticket info
      const enrichedLetters = letters?.map(letter => ({
        ...letter,
        user_email: userMap[letter.user_id] || null,
        ticket_info: ticketMap[letter.ticket_id] || null
      }));

      // Get total count
      const { count: totalCount } = await supabase
        .from('contest_letters')
        .select('*', { count: 'exact', head: true });

      res.status(200).json({
        success: true,
        letters: enrichedLetters || [],
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          total: totalCount || 0
        }
      });

    } else if (req.method === 'GET' && req.query.id) {
      // Get single letter with full text
      const { id } = req.query;

      const { data: letter, error } = await supabase
        .from('contest_letters')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        return res.status(404).json({ error: 'Letter not found' });
      }

      res.status(200).json({ success: true, letter });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error: any) {
    console.error('Admin contest letters error:', error);
    res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
});
