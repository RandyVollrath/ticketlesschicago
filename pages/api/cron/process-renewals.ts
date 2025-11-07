/**
 * Automated Renewal Processing Cron Job
 *
 * Runs daily to:
 * 1. Find customers with stickers expiring in X days (based on renewal_notification_days)
 * 2. Charge saved payment method
 * 3. Send payment to remitter via Stripe Connect
 * 4. Send order to remitter for fulfillment
 * 5. Notify customer
 * 6. Handle payment failures with email/SMS notifications
 */

import { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Sticker prices by type
const STICKER_PRICES = {
  passenger: 100,
  large_vehicle: 150,
  senior_disabled: 50,
};

const PLATFORM_FEE = 2; // $2 per renewal

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify this is a cron request (Vercel adds this header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      errors: [] as any[],
    };

    // Get customers with active subscriptions whose stickers are expiring soon
    const { data: customers, error: customersError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('concierge_service', true)
      .eq('subscription_status', 'active')
      .not('stripe_payment_method_id', 'is', null)
      .not('city_sticker_expiry', 'is', null);

    if (customersError) {
      throw customersError;
    }

    console.log(`Found ${customers?.length || 0} active concierge customers`);

    for (const customer of customers || []) {
      try {
        // Calculate days until expiration
        const expiryDate = new Date(customer.city_sticker_expiry);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Check if we should process this renewal
        const notificationDays = customer.renewal_notification_days || 30;

        if (daysUntilExpiry !== notificationDays) {
          // Not time to renew yet (or already past)
          continue;
        }

        // Check if we already processed this renewal
        const { data: existingCharge } = await supabase
          .from('renewal_charges')
          .select('*')
          .eq('user_id', customer.user_id)
          .eq('charge_type', 'sticker_renewal')
          .eq('renewal_due_date', customer.city_sticker_expiry)
          .eq('status', 'succeeded')
          .single();

        if (existingCharge) {
          console.log(`Already processed renewal for customer ${customer.user_id}`);
          continue;
        }

        results.processed++;

        // Get remitter for this customer's location
        // TODO: Assign based on zip code
        const { data: remitter } = await supabase
          .from('renewal_partners')
          .select('*')
          .eq('status', 'active')
          .single();

        if (!remitter || !remitter.stripe_connected_account_id) {
          throw new Error('No active remitter available');
        }

        // Determine sticker price
        const vehicleType = customer.vehicle_type || 'passenger';
        const stickerPrice = STICKER_PRICES[vehicleType as keyof typeof STICKER_PRICES] || STICKER_PRICES.passenger;
        const totalAmount = stickerPrice; // Customer pays sticker price
        const platformFeeAmount = PLATFORM_FEE; // You take $2

        // Create payment intent
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency: 'usd',
          customer: customer.stripe_customer_id,
          payment_method: customer.stripe_payment_method_id,
          confirm: true,
          description: `City Sticker Renewal - ${customer.license_plate}`,
          metadata: {
            user_id: customer.user_id,
            license_plate: customer.license_plate,
            renewal_type: 'city_sticker',
            expiry_date: customer.city_sticker_expiry,
          },

          // Send payment to remitter
          transfer_data: {
            destination: remitter.stripe_connected_account_id,
          },

          // Platform fee
          application_fee_amount: Math.round(platformFeeAmount * 100),

          // Send receipt to customer
          receipt_email: customer.email || undefined,
        });

        // Log successful charge
        await supabase.from('renewal_charges').insert({
          user_id: customer.user_id,
          charge_type: 'sticker_renewal',
          amount: totalAmount,
          stripe_payment_intent_id: paymentIntent.id,
          stripe_charge_id: paymentIntent.latest_charge as string,
          status: 'succeeded',
          remitter_partner_id: remitter.id,
          remitter_received_amount: totalAmount - platformFeeAmount,
          platform_fee_amount: platformFeeAmount,
          renewal_type: 'city_sticker',
          renewal_due_date: customer.city_sticker_expiry,
          succeeded_at: new Date().toISOString(),
          customer_notified: true,
          notification_sent_at: new Date().toISOString(),
        });

        // Create order for remitter
        await supabase.from('renewal_orders').insert({
          order_number: 'AUTO-' + Date.now(),
          partner_id: remitter.id,
          customer_name: `${customer.first_name} ${customer.last_name}`,
          customer_email: customer.email,
          customer_phone: customer.phone,
          license_plate: customer.license_plate,
          license_state: customer.license_state || 'IL',
          street_address: customer.street_address,
          city: customer.mailing_city || 'Chicago',
          state: customer.mailing_state || 'IL',
          zip_code: customer.zip_code,
          sticker_type: vehicleType,
          sticker_price: stickerPrice,
          service_fee: platformFeeAmount,
          total_amount: totalAmount,
          payment_status: 'paid',
          status: 'pending',
          stripe_payment_intent_id: paymentIntent.id,
        });

        // Send notification to customer (TODO: implement email/SMS)
        // await sendRenewalSuccessNotification(customer);

        results.succeeded++;

      } catch (error: any) {
        console.error(`Failed to process renewal for customer ${customer.user_id}:`, error);

        // Log failed charge
        await supabase.from('renewal_charges').insert({
          user_id: customer.user_id,
          charge_type: 'sticker_renewal',
          amount: 0,
          status: 'failed',
          failure_reason: error.message,
          failure_code: error.code || 'unknown',
          renewal_type: 'city_sticker',
          renewal_due_date: customer.city_sticker_expiry,
          failed_at: new Date().toISOString(),
        });

        // Send failure notification
        await sendPaymentFailureNotifications(customer, error.message);

        results.failed++;
        results.errors.push({
          customer_id: customer.user_id,
          license_plate: customer.license_plate,
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Renewal processing completed',
      results,
    });

  } catch (error: any) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      error: error.message,
      details: error.raw?.message,
    });
  }
}

/**
 * Send payment failure notifications via email and SMS
 */
async function sendPaymentFailureNotifications(customer: any, errorMessage: string) {
  try {
    // Get the failed charge
    const { data: failedCharge } = await supabase
      .from('renewal_charges')
      .select('*')
      .eq('user_id', customer.user_id)
      .eq('status', 'failed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!failedCharge) return;

    const message = `Your city sticker renewal payment failed. Reason: ${errorMessage}. Please update your payment method at autopilotamerica.com/dashboard to avoid service interruption.`;

    // Send email notification
    if (customer.email) {
      await supabase.from('payment_failure_notifications').insert({
        user_id: customer.user_id,
        renewal_charge_id: failedCharge.id,
        notification_type: 'email',
        recipient: customer.email,
        subject: 'Payment Failed - Action Required',
        message,
        status: 'pending',
      });

      // TODO: Actually send email via Resend
      // await sendEmail({
      //   to: customer.email,
      //   subject: 'Payment Failed - Action Required',
      //   text: message,
      // });
    }

    // Send SMS notification
    if (customer.phone) {
      await supabase.from('payment_failure_notifications').insert({
        user_id: customer.user_id,
        renewal_charge_id: failedCharge.id,
        notification_type: 'sms',
        recipient: customer.phone,
        message: message.substring(0, 160), // SMS character limit
        status: 'pending',
      });

      // TODO: Actually send SMS via Twilio
      // await sendSMS({
      //   to: customer.phone,
      //   body: message,
      // });
    }

  } catch (error) {
    console.error('Failed to send payment failure notifications:', error);
  }
}
