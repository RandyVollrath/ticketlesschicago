/**
 * Admin API: Confirm Payment Transfer
 *
 * POST /api/admin/confirm-payment-transfer
 *
 * Confirms that the original remitter has sent payment to the new remitter.
 * This updates the payment_transfer_status to 'confirmed' and sets the order
 * back to 'pending' so the new remitter can process it.
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

  const { orderId, notes } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: 'Order ID is required' });
  }

  try {
    // Get the order
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .select('id, order_number, partner_id, payment_transfer_status, original_partner_name')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.payment_transfer_status !== 'pending') {
      return res.status(400).json({
        error: `Cannot confirm payment transfer. Current status: ${order.payment_transfer_status}`
      });
    }

    // Get new partner name
    const { data: newPartner } = await supabase
      .from('renewal_partners')
      .select('name')
      .eq('id', order.partner_id)
      .single();

    // Update the order
    const confirmationNote = `Payment transfer confirmed by admin on ${new Date().toLocaleString()}. Original remitter (${order.original_partner_name}) sent funds to ${newPartner?.name || 'new remitter'}.${notes ? ` Notes: ${notes}` : ''}`;

    const { error: updateError } = await supabase
      .from('renewal_orders')
      .update({
        status: 'pending', // Reset to pending so new remitter can process
        payment_transfer_status: 'confirmed',
        payment_transfer_confirmed_at: new Date().toISOString(),
        internal_notes: confirmationNote,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Failed to confirm payment transfer:', updateError);
      return res.status(500).json({ error: 'Failed to confirm payment transfer' });
    }

    console.log(`Payment transfer confirmed for order ${order.order_number}`);

    return res.status(200).json({
      success: true,
      message: `Payment transfer confirmed. Order ${order.order_number} is now ready for the new remitter to process.`,
      order: {
        id: orderId,
        orderNumber: order.order_number,
        status: 'pending',
        paymentTransferStatus: 'confirmed'
      }
    });

  } catch (error: any) {
    console.error('Confirm payment transfer error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
