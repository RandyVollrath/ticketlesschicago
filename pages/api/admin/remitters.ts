/**
 * Admin API: List Remitters with Stats
 * GET /api/admin/remitters
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

  // Simple admin auth check
  const authHeader = req.headers.authorization;
  const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin';

  if (authHeader !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all remitters
    const { data: partners, error } = await supabase
      .from('renewal_partners')
      .select('id, name, email, status, is_default, stripe_connected_account_id')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (error) {
      console.error('Error fetching remitters:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    // Get order counts for each remitter
    const remittersWithStats = await Promise.all((partners || []).map(async (partner) => {
      const { count: pendingOrders } = await supabase
        .from('renewal_orders')
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', partner.id)
        .in('status', ['pending', 'processing']);

      const { count: totalOrders } = await supabase
        .from('renewal_orders')
        .select('*', { count: 'exact', head: true })
        .eq('partner_id', partner.id);

      return {
        ...partner,
        pending_orders: pendingOrders || 0,
        total_orders: totalOrders || 0
      };
    }));

    return res.status(200).json({
      success: true,
      remitters: remittersWithStats
    });

  } catch (error: any) {
    console.error('Remitters API error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
