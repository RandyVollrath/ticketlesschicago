/**
 * Remitter API: Request Order Transfer
 *
 * POST /api/remitter/request-transfer
 *
 * Allows a remitter to flag an order for transfer when they can't fulfill it.
 * The order goes into a "transfer_requested" state for admin review.
 *
 * IMPORTANT: This does NOT move any money. The original remitter must
 * send funds directly to the new remitter outside of Stripe (Zelle, bank transfer, etc.)
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

  // Authenticate remitter via API key
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    // Verify the remitter
    const { data: partner, error: partnerError } = await supabase
      .from('renewal_partners')
      .select('id, name, status')
      .eq('api_key', apiKey)
      .single();

    if (partnerError || !partner) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (partner.status !== 'active') {
      return res.status(403).json({ error: 'Partner account is not active' });
    }

    const { orderId, reason } = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Order ID is required' });
    }

    if (!reason || reason.trim().length < 10) {
      return res.status(400).json({ error: 'Please provide a reason (at least 10 characters)' });
    }

    // Get the order and verify it belongs to this remitter
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .select('id, order_number, partner_id, status, customer_name, license_plate')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.partner_id !== partner.id) {
      return res.status(403).json({ error: 'This order does not belong to you' });
    }

    // Check if order is in a state that can be transferred
    const transferableStatuses = ['pending', 'processing'];
    if (!transferableStatuses.includes(order.status)) {
      return res.status(400).json({
        error: `Cannot request transfer for order with status "${order.status}". Only pending or processing orders can be transferred.`
      });
    }

    // Check if already requested
    if (order.status === 'transfer_requested') {
      return res.status(400).json({ error: 'Transfer has already been requested for this order' });
    }

    // Update the order to transfer_requested status
    const transferNote = `TRANSFER REQUESTED by ${partner.name} on ${new Date().toLocaleString()}\nReason: ${reason.trim()}`;

    const { error: updateError } = await supabase
      .from('renewal_orders')
      .update({
        status: 'transfer_requested',
        payment_transfer_status: 'pending',
        payment_transfer_requested_at: new Date().toISOString(),
        remitter_notes: transferNote,
        updated_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Failed to request transfer:', updateError);
      return res.status(500).json({ error: 'Failed to request transfer' });
    }

    console.log(`📦 Transfer requested for order ${order.order_number} by ${partner.name}: ${reason}`);

    // TODO: Send notification to admin (email/SMS)

    return res.status(200).json({
      success: true,
      message: 'Transfer request submitted. Admin will reassign this order to another remitter.',
      order: {
        id: orderId,
        orderNumber: order.order_number,
        status: 'transfer_requested'
      },
      nextSteps: [
        'Admin will review and reassign to another remitter',
        'You will need to send the funds directly to the new remitter (Zelle, bank transfer, etc.)',
        'Admin will confirm once payment transfer is complete'
      ]
    });

  } catch (error: any) {
    console.error('Request transfer error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
