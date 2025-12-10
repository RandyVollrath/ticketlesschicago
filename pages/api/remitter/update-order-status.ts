import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const resend = new Resend(process.env.RESEND_API_KEY);

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

            // Send via ClickSend
            const smsResult = await sendClickSendSMS(userProfile.phone_number, smsMessage);
            if (smsResult.success) {
              console.log(`✅ SMS sent to ${userProfile.phone_number} for order ${orderId}`);
            } else {
              console.error(`❌ SMS failed for ${userProfile.phone_number}: ${smsResult.error}`);
            }

            // Schedule sticker arrival reminder (10 business days from now)
            // Store the reminder date on the order for the cron to pick up
            const reminderDate = new Date();
            reminderDate.setDate(reminderDate.getDate() + 14); // ~10 business days
            await supabase
              .from('renewal_orders')
              .update({
                sticker_reminder_date: reminderDate.toISOString().split('T')[0],
                sticker_reminder_count: 0,
                sticker_applied: false
              })
              .eq('id', orderId);

          } catch (smsError: any) {
            console.error('Failed to send SMS:', smsError);
            // Don't fail the request for SMS errors
          }
        } else {
          console.log(`No phone number on file for user ${userProfile.user_id}, skipping SMS`);
        }

        // Send CONFIRMATION EMAIL to customer
        if (order.customer_email) {
          try {
            const hasPermit = order.permit_requested || userProfile.permit_requested;
            const isLicensePlateOrder = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());
            const stickerType = isLicensePlateOrder ? 'License Plate' : 'City Sticker';
            const permitText = hasPermit ? ' + Residential Parking Permit' : '';

            const confirmationEmailHtml = `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                  <h1 style="margin: 0; font-size: 24px;">✅ Your ${stickerType}${permitText} Renewal is Complete!</h1>
                </div>
                <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                  <p>Hi${userProfile.first_name ? ` ${userProfile.first_name}` : ''},</p>

                  <p>Great news! Your ${stickerType.toLowerCase()}${permitText.toLowerCase()} renewal has been successfully submitted to ${isLicensePlateOrder ? 'the Illinois Secretary of State' : 'the City of Chicago'}.</p>

                  <div style="background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin: 16px 0;">
                    <h3 style="margin: 0 0 12px; color: #065f46;">Confirmation Details</h3>
                    <div style="line-height: 1.8;">
                      <div><strong>Confirmation #:</strong> ${confirmationNumber}</div>
                      <div><strong>License Plate:</strong> ${order.license_plate}</div>
                      <div><strong>Renewal Type:</strong> ${stickerType}${permitText}</div>
                      <div><strong>Mailing Address:</strong> ${order.street_address}, ${order.city}, ${order.state} ${order.zip_code}</div>
                    </div>
                  </div>

                  <p><strong>What's next?</strong></p>
                  <ol style="line-height: 1.8; color: #374151;">
                    <li>Your new sticker will be mailed to the address above</li>
                    <li>Expect delivery in <strong>7-14 business days</strong></li>
                    <li>Once received, remove old sticker and apply the new one immediately</li>
                    <li>We'll send you a reminder to confirm you received and applied your sticker</li>
                  </ol>

                  <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;">
                    <strong style="color: #92400e;">💡 Pro Tip:</strong>
                    <p style="margin: 8px 0 0; color: #78350f;">
                      Keep your confirmation number (${confirmationNumber}) for your records. If your sticker doesn't arrive within 14 business days, contact us and we'll help track it down.
                    </p>
                  </div>

                  <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                    Questions? Reply to this email or contact support@autopilotamerica.com
                  </p>

                  <p style="color: #6b7280; font-size: 14px;">
                    Thanks for using Autopilot America!
                  </p>
                </div>
              </div>
            `;

            await resend.emails.send({
              from: 'Autopilot America <alerts@autopilotamerica.com>',
              to: [order.customer_email],
              subject: `✅ Your ${stickerType}${permitText} Renewal is Complete - Confirmation #${confirmationNumber}`,
              html: confirmationEmailHtml,
              headers: {
                'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>'
              },
              replyTo: 'support@autopilotamerica.com'
            });
            console.log(`📧 Confirmation email sent to ${order.customer_email}`);
          } catch (emailError) {
            console.error('Failed to send confirmation email:', emailError);
            // Don't fail the request for email errors
          }
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
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
