import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Check admin auth
    const authHeader = req.headers.authorization;
    const adminToken = req.headers['x-admin-token'];

    if (adminToken !== process.env.ADMIN_API_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized - Invalid admin token' });
    }

    if (req.method === 'GET') {
      // List all contests
      const { status, limit = '50', offset = '0' } = req.query;

      let query = supabase
        .from('ticket_contests')
        .select(`
          *,
          user_profiles!ticket_contests_user_id_fkey (
            full_name,
            email,
            phone
          )
        `)
        .order('created_at', { ascending: false })
        .range(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string) - 1);

      if (status) {
        query = query.eq('status', status);
      }

      const { data: contests, error: fetchError, count } = await query;

      if (fetchError) {
        console.error('Fetch error:', fetchError);
        return res.status(500).json({ error: 'Failed to fetch contests: ' + fetchError.message });
      }

      // Get total count
      const { count: totalCount } = await supabase
        .from('ticket_contests')
        .select('*', { count: 'exact', head: true });

      res.status(200).json({
        success: true,
        contests: contests || [],
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string),
          total: totalCount || 0
        }
      });

    } else if (req.method === 'PATCH') {
      // Update contest
      const { contestId, status, admin_notes } = req.body;

      if (!contestId) {
        return res.status(400).json({ error: 'Contest ID required' });
      }

      const updateData: any = {};
      if (status) updateData.status = status;
      if (admin_notes !== undefined) updateData.admin_notes = admin_notes;

      const { data: contest, error: updateError } = await supabase
        .from('ticket_contests')
        .update(updateData)
        .eq('id', contestId)
        .select()
        .single();

      if (updateError) {
        console.error('Update error:', updateError);
        return res.status(500).json({ error: 'Failed to update contest: ' + updateError.message });
      }

      res.status(200).json({
        success: true,
        contest
      });

    } else {
      return res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error: any) {
    console.error('Admin contests error:', error);
    res.status(500).json({ error: error.message });
  }
}
