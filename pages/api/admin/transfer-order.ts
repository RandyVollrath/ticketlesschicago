/**
 * Admin API: Transfer Order to Different Remitter
 *
 * POST /api/admin/transfer-order
 * Body: { orderId: string, newPartnerId: string }
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Simple admin auth check
  const authHeader = req.headers.authorization;
  const adminToken = process.env.ADMIN_API_TOKEN || 'ticketless2025admin';

  if (authHeader !== `Bearer ${adminToken}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { orderId, newPartnerId } = req.body;

  if (!orderId || !newPartnerId) {
    return res.status(400).json({ error: 'Missing orderId or newPartnerId' });
  }

  try {
    // Get the order
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .select('id, order_number, partner_id, status, customer_email')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Verify new partner exists and is active with Stripe
    const { data: newPartner, error: partnerError } = await supabase
      .from('renewal_partners')
      .select('id, name, status, stripe_connected_account_id')
      .eq('id', newPartnerId)
      .single();

    if (partnerError || !newPartner) {
      return res.status(404).json({ error: 'Target remitter not found' });
    }

    if (newPartner.status !== 'active') {
      return res.status(400).json({ error: 'Target remitter is not active' });
    }

    if (!newPartner.stripe_connected_account_id) {
      return res.status(400).json({ error: 'Target remitter does not have Stripe connected' });
    }

    // Get old partner name for logging
    const { data: oldPartner } = await supabase
      .from('renewal_partners')
      .select('name')
      .eq('id', order.partner_id)
      .single();

    // Transfer the order
    const { error: updateError } = await supabase
      .from('renewal_orders')
      .update({
        partner_id: newPartnerId,
        updated_at: new Date().toISOString(),
        internal_notes: `Transferred from "${oldPartner?.name || 'Unknown'}" to "${newPartner.name}" by admin on ${new Date().toLocaleString()}`
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Failed to transfer order:', updateError);
      return res.status(500).json({ error: 'Failed to transfer order' });
    }

    console.log(`📦 Order ${order.order_number} transferred from "${oldPartner?.name}" to "${newPartner.name}"`);

    return res.status(200).json({
      success: true,
      message: `Order ${order.order_number} transferred to ${newPartner.name}`,
      order: {
        id: orderId,
        orderNumber: order.order_number,
        oldPartner: oldPartner?.name,
        newPartner: newPartner.name
      }
    });

  } catch (error: any) {
    console.error('Transfer order error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
