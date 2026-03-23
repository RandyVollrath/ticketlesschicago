/**
 * Admin API: List Remitters with Stats
 * GET /api/admin/remitters
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAdminAuth } from '../../../lib/auth-middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate admin via JWT or session cookie
  const admin = await requireAdminAuth(req, res);
  if (!admin) return;

  try {
    // Get all remitters — exclude raw api_key, mask stripe account ID
    const { data: partners, error } = await supabase
      .from('renewal_partners')
      .select('id, name, email, status, is_default, stripe_connected_account_id, api_key')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    // Strip sensitive fields before returning
    const safePartners = (partners || []).map(({ api_key, stripe_connected_account_id, ...rest }) => ({
      ...rest,
      api_key_hint: api_key ? `...${api_key.slice(-6)}` : null,
      has_stripe_account: !!stripe_connected_account_id,
    }));

    if (error) {
      console.error('Error fetching remitters:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch remitters' });
    }

    // Get order counts for each remitter
    const remittersWithStats = await Promise.all(safePartners.map(async (partner) => {
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
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
