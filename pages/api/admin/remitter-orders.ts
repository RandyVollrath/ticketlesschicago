/**
 * Admin API: Get Orders for a Specific Remitter
 * GET /api/admin/remitter-orders?remitterId=xxx
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

  const { remitterId } = req.query;

  if (!remitterId || typeof remitterId !== 'string') {
    return res.status(400).json({ success: false, error: 'remitterId is required' });
  }

  try {
    const { data: orders, error } = await supabase
      .from('renewal_orders')
      .select('id, order_number, customer_email, customer_name, license_plate, sticker_type, status, total_amount, partner_id, created_at, renewal_due_date, original_partner_id, original_partner_name, payment_transfer_status, transferred_at')
      .eq('partner_id', remitterId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      console.error('Error fetching orders:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({
      success: true,
      orders: orders || []
    });

  } catch (error: any) {
    console.error('Remitter orders API error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
