/**
 * Payment Processing for City Sticker Renewals
 * Uses Stripe Connect to automatically forward funds to partner's account
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';
import { sendClickSendSMS } from '../../../lib/sms-service';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { orderId, paymentMethodId } = req.body;

  if (!orderId || !paymentMethodId) {
    return res.status(400).json({ error: 'Missing orderId or paymentMethodId' });
  }

  try {
    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('renewal_orders')
      .select('*, renewal_partners(*)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.payment_status === 'paid') {
      return res.status(400).json({ error: 'Order already paid' });
    }

    const partner = order.renewal_partners;

    if (!partner.stripe_connected_account_id) {
      return res.status(400).json({
        error: 'Partner has not completed payment setup',
      });
    }

    // Platform fee - fixed $2 per transaction (or configured amount)
    const platformFeeAmount = Math.round((partner.service_fee_amount || 2) * 100); // in cents

    // Create payment intent - money goes DIRECTLY to remitter
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(order.total_amount * 100), // Convert to cents
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: 'never',
      },
      description: `City Sticker Renewal - ${order.order_number}`,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        partner_id: partner.id,
        partner_name: partner.name,
        license_plate: order.license_plate,
      },

      // DIRECT payment to remitter's account
      transfer_data: {
        destination: partner.stripe_connected_account_id,
      },

      // Your platform fee (deducted from remitter's payment)
      application_fee_amount: platformFeeAmount,

      // Receipt email
      receipt_email: order.customer_email,
    });

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        error: 'Payment failed',
        status: paymentIntent.status,
      });
    }

    // Update order with payment info
    const { error: updateError } = await supabase
      .from('renewal_orders')
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_status: 'paid',
        paid_at: new Date().toISOString(),
        status: 'payment_received',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Order update error:', updateError);
    }

    // Log activity
    await logActivity(
      orderId,
      'payment_received',
      `Payment of $${order.total_amount} received via Stripe`,
      { payment_intent_id: paymentIntent.id },
      'customer'
    );

    // Send payment confirmation
    await sendPaymentConfirmation(order);

    // Push order to partner portal (if enabled)
    if (partner.portal_integration_type === 'api' && !order.pushed_to_portal) {
      await pushToPartnerPortal(order, partner);
    }

    // Update partner stats
    await updatePartnerStats(partner.id, order.total_amount);

    return res.status(200).json({
      success: true,
      paymentIntent: {
        id: paymentIntent.id,
        status: paymentIntent.status,
      },
      order: {
        id: order.id,
        orderNumber: order.order_number,
        status: 'payment_received',
      },
      message: 'Payment successful! Your renewal order is being processed.',
      nextSteps: [
        'Your documents are being verified',
        ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase())
          ? 'Order will be submitted to the IL Secretary of State'
          : 'Order will be submitted to the City of Chicago',
        partner.fulfillment_method === 'mail'
          ? 'Your sticker will be mailed to you'
          : 'You will be notified when your sticker is ready for pickup',
      ],
    });

  } catch (error: any) {
    console.error('Payment processing error:', error);

    // Log failed payment
    if (orderId) {
      await logActivity(
        orderId,
        'payment_failed',
        `Payment failed: ${error.message}`,
        { error: error.message },
        'system'
      );
    }

    return res.status(500).json({
      error: error.message || 'Payment processing failed',
    });
  }
}

async function logActivity(
  orderId: string,
  activityType: string,
  description: string,
  metadata: any = null,
  performedByType: string = 'system'
) {
  await supabase.from('renewal_order_activity_log').insert({
    order_id: orderId,
    activity_type: activityType,
    description,
    performed_by_type: performedByType,
    metadata,
  });
}

async function sendPaymentConfirmation(order: any) {
  const partner = order.renewal_partners;
  const isLicensePlate = ['standard', 'vanity'].includes(order.sticker_type?.toLowerCase());
  const renewalType = isLicensePlate ? 'License Plate Sticker' : 'City Sticker';

  // Send email confirmation
  try {
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      timeout: DEFAULT_TIMEOUTS.email,
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Autopilot America <orders@autopilotamerica.com>',
        to: order.customer_email,
        subject: `Payment Confirmed - ${renewalType} Renewal #${order.order_number}`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #10b981; padding: 24px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">Payment Confirmed!</h1>
            </div>

            <div style="padding: 24px; background-color: #f9fafb;">
              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Hi ${order.customer_name.split(' ')[0]},
              </p>

              <p style="color: #374151; font-size: 16px; line-height: 1.6;">
                Thank you for your payment! Your ${renewalType.toLowerCase()} renewal is now being processed.
              </p>

              <div style="background-color: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
                <h2 style="margin-top: 0; color: #1a1a1a; font-size: 18px;">Order Details</h2>
                <table style="width: 100%; font-size: 14px;">
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Order Number:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: 600;">${order.order_number}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">License Plate:</td>
                    <td style="padding: 8px 0; text-align: right; font-weight: 600;">${order.license_plate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #6b7280;">Renewal Type:</td>
                    <td style="padding: 8px 0; text-align: right;">${renewalType}</td>
                  </tr>
                  <tr style="border-top: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0 8px 0; color: #1a1a1a; font-weight: 600;">Total Paid:</td>
                    <td style="padding: 12px 0 8px 0; text-align: right; font-weight: 600; font-size: 18px; color: #10b981;">$${order.total_amount.toFixed(2)}</td>
                  </tr>
                </table>
              </div>

              <div style="background-color: #dbeafe; border-radius: 8px; padding: 16px; margin: 24px 0;">
                <h3 style="margin: 0 0 8px 0; color: #1e40af; font-size: 14px;">What happens next?</h3>
                <ol style="margin: 0; padding-left: 20px; color: #1e40af; font-size: 14px; line-height: 1.8;">
                  <li>Your documents are being verified</li>
                  <li>Your order will be submitted to ${isLicensePlate ? 'the IL Secretary of State' : 'the City of Chicago'}</li>
                  <li>${partner?.fulfillment_method === 'pickup' ? 'You\'ll be notified when your sticker is ready for pickup' : 'Your sticker will be mailed to your address'}</li>
                </ol>
              </div>

              <p style="color: #6b7280; font-size: 14px;">
                We'll send you updates as your renewal is processed. If you have questions, reply to this email or contact us at support@autopilotamerica.com.
              </p>
            </div>

            <div style="padding: 16px 24px; background-color: #f3f4f6; text-align: center;">
              <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                Autopilot America • <a href="https://autopilotamerica.com" style="color: #3b82f6;">autopilotamerica.com</a>
              </p>
            </div>
          </div>
        `
      })
    });

    if (response.ok) {
      console.log(`✅ Payment confirmation email sent to ${order.customer_email}`);
    } else {
      console.error(`❌ Failed to send payment confirmation email: ${response.status}`);
    }
  } catch (error) {
    console.error('❌ Email sending error:', error);
  }

  // Send SMS confirmation if phone number available
  if (order.customer_phone) {
    try {
      const smsMessage = `Payment confirmed! Your ${renewalType} renewal order #${order.order_number} for ${order.license_plate} is being processed. We'll text you when it's complete. - Autopilot America`;

      const result = await sendClickSendSMS(order.customer_phone, smsMessage);
      if (result.success) {
        console.log(`✅ Payment confirmation SMS sent to ${order.customer_phone}`);
      } else {
        console.error(`❌ Failed to send SMS: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ SMS sending error:', error);
    }
  }
}

async function pushToPartnerPortal(order: any, partner: any) {
  if (!partner.portal_credentials_encrypted || !partner.webhook_url) {
    return;
  }

  try {
    // Call partner's API to create renewal in their system
    const response = await fetch(partner.webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': partner.api_key,
      },
      body: JSON.stringify({
        action: 'create_renewal',
        order: {
          orderNumber: order.order_number,
          customer: {
            name: order.customer_name,
            email: order.customer_email,
            phone: order.customer_phone,
            address: {
              street: order.street_address,
              city: order.city,
              state: order.state,
              zip: order.zip_code,
            },
          },
          vehicle: {
            licensePlate: order.license_plate,
            state: order.license_state,
            vin: order.vin,
            make: order.make,
            model: order.model,
            year: order.year,
          },
          stickerType: order.sticker_type,
          amount: order.total_amount,
          documents: order.documents,
        },
      }),
    });

    if (response.ok) {
      const result = await response.json();

      await supabase
        .from('renewal_orders')
        .update({
          pushed_to_portal: true,
          pushed_to_portal_at: new Date().toISOString(),
          portal_confirmation_number: result.confirmationNumber || null,
        })
        .eq('id', order.id);

      await logActivity(
        order.id,
        'sent_to_portal',
        `Order sent to partner portal: ${partner.name}`,
        { confirmation: result.confirmationNumber },
        'system'
      );
    } else {
      throw new Error(`Portal API returned ${response.status}`);
    }
  } catch (error: any) {
    console.error('Portal push failed:', error);

    await supabase
      .from('renewal_orders')
      .update({
        portal_error: error.message,
      })
      .eq('id', order.id);

    await logActivity(
      order.id,
      'portal_push_failed',
      `Failed to push to partner portal: ${error.message}`,
      null,
      'system'
    );
  }
}

async function updatePartnerStats(partnerId: string, orderAmount: number) {
  // Update today's stats
  const { data: stats } = await supabase
    .from('renewal_partner_stats')
    .select('*')
    .eq('partner_id', partnerId)
    .single();

  if (stats) {
    await supabase
      .from('renewal_partner_stats')
      .update({
        orders_today: stats.orders_today + 1,
        revenue_today: stats.revenue_today + orderAmount,
        orders_this_week: stats.orders_this_week + 1,
        revenue_this_week: stats.revenue_this_week + orderAmount,
        orders_this_month: stats.orders_this_month + 1,
        revenue_this_month: stats.revenue_this_month + orderAmount,
        total_orders: stats.total_orders + 1,
        total_revenue: stats.total_revenue + orderAmount,
        last_updated: new Date().toISOString(),
      })
      .eq('partner_id', partnerId);
  } else {
    // Create initial stats
    await supabase.from('renewal_partner_stats').insert({
      partner_id: partnerId,
      orders_today: 1,
      revenue_today: orderAmount,
      orders_this_week: 1,
      revenue_this_week: orderAmount,
      orders_this_month: 1,
      revenue_this_month: orderAmount,
      total_orders: 1,
      total_revenue: orderAmount,
    });
  }
}
