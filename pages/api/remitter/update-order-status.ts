import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Update Order Status API
 *
 * POST /api/remitter/update-order-status
 *
 * Body:
 * - orderId: string (required)
 * - status: 'processing' | 'submitted' | 'completed' | 'cancelled' (required)
 * - confirmationNumber?: string (required when status = 'completed')
 * - notes?: string
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Authenticate partner via API key
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) {
    return res.status(401).json({ error: 'Missing API key' });
  }

  const { data: partner, error: partnerError } = await supabase
    .from('renewal_partners')
    .select('*')
    .eq('api_key', apiKey)
    .eq('status', 'active')
    .single();

  if (partnerError || !partner) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { orderId, status, confirmationNumber, notes } = req.body;

  if (!orderId || !status) {
    return res.status(400).json({ error: 'Missing orderId or status' });
  }

  const validStatuses = ['processing', 'submitted', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  if (status === 'completed' && !confirmationNumber) {
    return res.status(400).json({ error: 'Confirmation number required when marking as completed' });
  }

  try {
    // Verify order belongs to this partner
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .select('*')
      .eq('id', orderId)
      .eq('partner_id', partner.id)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Build update object
    const updateData: any = {
      status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'processing') {
      updateData.processing_started_at = new Date().toISOString();
    }

    if (status === 'submitted') {
      updateData.submitted_at = new Date().toISOString();
    }

    if (status === 'completed') {
      updateData.city_confirmation_number = confirmationNumber;
      updateData.completed_at = new Date().toISOString();
    }

    if (notes) {
      updateData.remitter_notes = notes;
    }

    // Update the order
    const { data: updatedOrder, error: updateError } = await supabase
      .from('renewal_orders')
      .update(updateData)
      .eq('id', orderId)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating order:', updateError);
      return res.status(500).json({ error: 'Failed to update order' });
    }

    // If completed, also update the user's expiry date and send SMS
    if (status === 'completed' && order.customer_email) {
      // Find user by email and update expiry
      const { data: userProfile } = await supabase
        .from('user_profiles')
        .select('user_id, phone_number, first_name, city_sticker_expiry, license_plate_expiry, permit_requested')
        .eq('email', order.customer_email)
        .single();

      if (userProfile) {
        // Determine renewal type from order
        const isLicensePlate = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());
        const expiryField = isLicensePlate ? 'license_plate_expiry' : 'city_sticker_expiry';
        const currentExpiry = isLicensePlate ? userProfile.license_plate_expiry : userProfile.city_sticker_expiry;

        if (currentExpiry) {
          const currentDate = new Date(currentExpiry);
          currentDate.setFullYear(currentDate.getFullYear() + 1);
          const newExpiry = currentDate.toISOString().split('T')[0];

          await supabase
            .from('user_profiles')
            .update({ [expiryField]: newExpiry })
            .eq('user_id', userProfile.user_id);

          console.log(`Updated ${expiryField} to ${newExpiry} for user ${userProfile.user_id}`);
        }

        // Send SMS notification to customer using phone from user_profiles (not order)
        if (userProfile.phone_number) {
          try {
            const hasPermit = order.permit_requested || userProfile.permit_requested;
            const isLicensePlateOrder = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());

            let smsMessage: string;
            if (isLicensePlateOrder) {
              smsMessage = `Great news${userProfile.first_name ? `, ${userProfile.first_name}` : ''}! Your license plate renewal has been submitted to the IL Secretary of State. Confirmation #${confirmationNumber}. Your new sticker will be mailed to ${order.street_address}. Thanks for using Autopilot America!`;
            } else {
              smsMessage = `Great news${userProfile.first_name ? `, ${userProfile.first_name}` : ''}! Your ${hasPermit ? 'city sticker and residential permit have' : 'city sticker has'} been submitted to the City of Chicago. Confirmation #${confirmationNumber}. Your new sticker will be mailed to ${order.street_address}. Thanks for using Autopilot America!`;
            }

            // Use Twilio or your SMS provider
            const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
            const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
            const twilioFromNumber = process.env.TWILIO_PHONE_NUMBER;

            if (twilioAccountSid && twilioAuthToken && twilioFromNumber) {
              const twilioClient = require('twilio')(twilioAccountSid, twilioAuthToken);
              await twilioClient.messages.create({
                body: smsMessage,
                from: twilioFromNumber,
                to: userProfile.phone_number,
              });
              console.log(`SMS sent to ${userProfile.phone_number} for order ${orderId}`);
            } else {
              console.log(`SMS would be sent to ${userProfile.phone_number}: ${smsMessage}`);
            }
          } catch (smsError: any) {
            console.error('Failed to send SMS:', smsError.message);
            // Don't fail the request for SMS errors
          }
        } else {
          console.log(`No phone number on file for user ${userProfile.user_id}, skipping SMS`);
        }
      }
    }

    // Log activity
    await supabase.from('renewal_order_activity_log').insert({
      order_id: orderId,
      activity_type: `status_changed_to_${status}`,
      description: `Order status changed to ${status}${confirmationNumber ? ` (Confirmation: ${confirmationNumber})` : ''}`,
      performed_by_type: 'remitter',
      performed_by_id: partner.id,
      metadata: { status, confirmationNumber, notes },
    });

    return res.status(200).json({
      success: true,
      order: updatedOrder,
      message: `Order status updated to ${status}`,
    });

  } catch (error: any) {
    console.error('Error in update-order-status:', error);
    return res.status(500).json({ error: error.message });
  }
}
