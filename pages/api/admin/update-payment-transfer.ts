/**
 * Admin API: Update Payment Transfer Status
 * PATCH /api/admin/update-payment-transfer
 * Body: { orderId: string, status: 'requested' | 'confirmed' }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin auth check
  const authHeader = req.headers.authorization;
  const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || 'ticketless2025admin';

  if (authHeader !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { orderId, status } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({ success: false, error: 'orderId and status are required' });
  }

  if (!['requested', 'confirmed'].includes(status)) {
    return res.status(400).json({ success: false, error: 'status must be "requested" or "confirmed"' });
  }

  try {
    const updateData: Record<string, any> = {
      payment_transfer_status: status,
      updated_at: new Date().toISOString()
    };

    if (status === 'requested') {
      updateData.payment_transfer_requested_at = new Date().toISOString();
    } else if (status === 'confirmed') {
      updateData.payment_transfer_confirmed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('renewal_orders')
      .update(updateData)
      .eq('id', orderId)
      .select('order_number, payment_transfer_status')
      .single();

    if (error) {
      console.error('Error updating payment transfer status:', error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.status(200).json({
      success: true,
      message: `Payment transfer marked as ${status}`,
      order: data
    });

  } catch (error: any) {
    console.error('Update payment transfer error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
