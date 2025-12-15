/**
 * Admin API: Get Transfer Requests
 *
 * GET /api/admin/transfer-requests
 * - Returns orders that have been flagged for transfer
 * - Includes both transfer_requested status and orders with pending payment_transfer_status
 *
 * GET /api/admin/transfer-requests?countOnly=true
 * - Returns just the count (for badge)
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
  const adminToken = process.env.ADMIN_API_TOKEN || 'ticketless2025admin';

  if (authHeader !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { countOnly } = req.query;

  try {
    if (countOnly === 'true') {
      // Just get the count for the badge
      const { count, error } = await supabase
        .from('renewal_orders')
        .select('id', { count: 'exact', head: true })
        .or('status.eq.transfer_requested,and(payment_transfer_status.eq.pending,status.neq.transfer_requested)');

      if (error) {
        console.error('Error counting transfer requests:', error);
        return res.status(500).json({ success: false, error: 'Failed to count transfer requests' });
      }

      return res.status(200).json({ success: true, count: count || 0 });
    }

    // Get full list of transfer requests
    const { data: orders, error } = await supabase
      .from('renewal_orders')
      .select(`
        id,
        order_number,
        partner_id,
        customer_name,
        customer_email,
        customer_phone,
        license_plate,
        street_address,
        city,
        state,
        zip_code,
        sticker_type,
        sticker_price,
        service_fee,
        total_amount,
        status,
        payment_transfer_status,
        payment_transfer_requested_at,
        payment_transfer_confirmed_at,
        original_partner_id,
        original_partner_name,
        remitter_notes,
        created_at
      `)
      .or('status.eq.transfer_requested,payment_transfer_status.eq.pending')
      .order('payment_transfer_requested_at', { ascending: false });

    if (error) {
      console.error('Error fetching transfer requests:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch transfer requests' });
    }

    // Get partner names for all orders
    const partnerIds = [...new Set(orders?.map(o => o.partner_id) || [])];
    const { data: partners } = await supabase
      .from('renewal_partners')
      .select('id, name')
      .in('id', partnerIds);

    const partnerMap = new Map();
    partners?.forEach(p => partnerMap.set(p.id, p.name));

    // Enrich orders with partner names
    const enrichedOrders = (orders || []).map(order => ({
      ...order,
      partner_name: partnerMap.get(order.partner_id) || 'Unknown',
      // If transferred, find new partner name
      new_partner_name: order.original_partner_id ? partnerMap.get(order.partner_id) : null
    }));

    return res.status(200).json({
      success: true,
      orders: enrichedOrders
    });

  } catch (error: any) {
    console.error('Transfer requests error:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
