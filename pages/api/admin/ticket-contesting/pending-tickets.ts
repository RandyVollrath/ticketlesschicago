/**
 * Admin API: Get Pending Ticket Findings
 *
 * Returns tickets from va_ticket_findings that are in 'pending' status
 * and ready for letter generation.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { data: tickets, error, count } = await supabase
      .from('va_ticket_findings')
      .select('*', { count: 'exact' })
      .eq('processing_status', 'pending')
      .not('ticket_number', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      throw error;
    }

    return res.status(200).json({
      success: true,
      tickets: tickets || [],
      count: count || 0,
    });
  } catch (error: any) {
    console.error('Error fetching pending tickets:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch pending tickets' });
  }
}
