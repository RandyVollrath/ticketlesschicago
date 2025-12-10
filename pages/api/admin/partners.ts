/**
 * Admin Partners Management API
 * GET - List all partners/remitters
 * PATCH - Update partner status or settings
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { withAdminAuth } from '../../../lib/auth-middleware';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    try {
      // Fetch all partners with their stats
      const { data: partners, error } = await supabase
        .from('renewal_partners')
        .select(`
          id,
          name,
          email,
          phone,
          business_type,
          business_address,
          license_number,
          stripe_connected_account_id,
          stripe_account_status,
          payout_enabled,
          api_key,
          notification_email,
          notify_daily_digest,
          notify_instant_alerts,
          notify_weekly_summary,
          commission_percentage,
          service_fee_amount,
          status,
          onboarding_completed,
          created_at,
          updated_at
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching partners:', error);
        return res.status(500).json({ success: false, error: error.message });
      }

      // For each partner, get their order stats
      const partnersWithStats = await Promise.all((partners || []).map(async (partner) => {
        // Get order counts
        const { count: totalOrders } = await supabase
          .from('renewal_orders')
          .select('*', { count: 'exact', head: true })
          .eq('partner_id', partner.id);

        const { count: pendingOrders } = await supabase
          .from('renewal_orders')
          .select('*', { count: 'exact', head: true })
          .eq('partner_id', partner.id)
          .in('status', ['submitted', 'payment_received', 'processing']);

        const { count: completedOrders } = await supabase
          .from('renewal_orders')
          .select('*', { count: 'exact', head: true })
          .eq('partner_id', partner.id)
          .eq('status', 'completed');

        // Get revenue (sum of amounts for completed orders)
        const { data: revenueData } = await supabase
          .from('renewal_orders')
          .select('total_amount')
          .eq('partner_id', partner.id)
          .eq('status', 'completed');

        const totalRevenue = revenueData?.reduce((sum, order) => sum + (order.total_amount || 0), 0) || 0;

        return {
          ...partner,
          stats: {
            totalOrders: totalOrders || 0,
            pendingOrders: pendingOrders || 0,
            completedOrders: completedOrders || 0,
            totalRevenue
          }
        };
      }));

      return res.status(200).json({
        success: true,
        partners: partnersWithStats,
        summary: {
          total: partners?.length || 0,
          active: partners?.filter(p => p.status === 'active').length || 0,
          stripeConnected: partners?.filter(p => p.stripe_connected_account_id).length || 0,
          payoutEnabled: partners?.filter(p => p.payout_enabled).length || 0
        }
      });

    } catch (error: any) {
      console.error('Partners API error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  if (req.method === 'PATCH') {
    const { partnerId, updates } = req.body;

    if (!partnerId) {
      return res.status(400).json({ success: false, error: 'Partner ID required' });
    }

    // Only allow certain fields to be updated
    const allowedFields = [
      'status',
      'notification_email',
      'notify_daily_digest',
      'notify_instant_alerts',
      'notify_weekly_summary',
      'commission_percentage',
      'service_fee_amount'
    ];

    const sanitizedUpdates: Record<string, any> = {};
    for (const [key, value] of Object.entries(updates || {})) {
      if (allowedFields.includes(key)) {
        sanitizedUpdates[key] = value;
      }
    }

    if (Object.keys(sanitizedUpdates).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid updates provided' });
    }

    sanitizedUpdates.updated_at = new Date().toISOString();

    try {
      const { data, error } = await supabase
        .from('renewal_partners')
        .update(sanitizedUpdates)
        .eq('id', partnerId)
        .select()
        .single();

      if (error) {
        console.error('Error updating partner:', error);
        return res.status(500).json({ success: false, error: error.message });
      }

      return res.status(200).json({
        success: true,
        partner: data
      });

    } catch (error: any) {
      console.error('Partner update error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export default withAdminAuth(handler);
