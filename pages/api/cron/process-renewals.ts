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
import stripeConfig from '../../../lib/stripe-config';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-12-18.acacia',
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Map vehicle types to Stripe Price IDs (source of truth for pricing)
const STICKER_PRICE_IDS: Record<string, string | undefined> = {
  MB: stripeConfig.cityStickerMbPriceId,
  P: stripeConfig.cityStickerPPriceId,
  LP: stripeConfig.cityStickerLpPriceId,
  ST: stripeConfig.cityStickerStPriceId,
  LT: stripeConfig.cityStickerLtPriceId,
};

/**
 * Fetch sticker price from Stripe for a given vehicle type
 * This ensures prices stay in sync with Stripe dashboard
 */
async function getStickerPrice(vehicleType: string): Promise<number> {
  const priceId = STICKER_PRICE_IDS[vehicleType] || STICKER_PRICE_IDS.P;

  if (!priceId) {
    throw new Error(`No Stripe price ID configured for vehicle type: ${vehicleType}`);
  }

  try {
    const price = await stripe.prices.retrieve(priceId);

    if (!price.unit_amount) {
      throw new Error(`Stripe price ${priceId} has no unit_amount`);
    }

    // Convert from cents to dollars
    return price.unit_amount / 100;
  } catch (error: any) {
    console.error(`Failed to fetch price for ${vehicleType}:`, error);
    throw new Error(`Failed to fetch sticker price: ${error.message}`);
  }
}

// Stripe processing fee: 2.9% + $0.30
const STRIPE_PERCENTAGE_FEE = 0.029;
const STRIPE_FIXED_FEE = 0.30;

// Service fee for operational costs (infrastructure, support, risk management)
const SERVICE_FEE = 2.50;

/**
 * Calculate total charge to cover sticker price, service fee, and Stripe's processing fee
 *
 * Math:
 * - Customer pays total T
 * - Stripe takes 2.9% of T + $0.30
 * - Remitter receives exact sticker price S
 * - Platform receives service fee F ($2.50)
 *
 * T = S + F + (0.029 * T + 0.30)
 * T - 0.029T = S + F + 0.30
 * 0.971T = S + F + 0.30
 * T = (S + F + 0.30) / 0.971
 *
 * This ensures after Stripe takes their fee and remitter gets their exact amount,
 * platform nets the full service fee.
 */
function calculateTotalWithFees(stickerPrice: number): {
  total: number;
  serviceFee: number;
} {
  const total = (stickerPrice + SERVICE_FEE + STRIPE_FIXED_FEE) / (1 - STRIPE_PERCENTAGE_FEE);
  return {
    total: Math.round(total * 100) / 100, // Round to 2 decimals
    serviceFee: SERVICE_FEE,
  };
}

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

    // Get customers with active Protection subscriptions whose stickers are expiring soon
    const { data: customers, error: customersError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('has_protection', true)
      .not('stripe_customer_id', 'is', null)
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

        // Process if within renewal window (up to 30 days before expiration)
        // This handles missed cron runs - if cron fails on day 30, it will catch on day 29, 28, etc.
        if (daysUntilExpiry > notificationDays) {
          // Too early - not time yet
          continue;
        }

        if (daysUntilExpiry < 0) {
          // Already expired - too late to renew
          console.log(`Sticker already expired for customer ${customer.user_id} (${Math.abs(daysUntilExpiry)} days ago)`);
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

        // Determine sticker price based on vehicle type
        const vehicleType = customer.vehicle_type || 'P'; // Default to Passenger

        // Fetch current price from Stripe (ensures prices stay in sync with dashboard)
        const stickerPrice = await getStickerPrice(vehicleType);

        // Calculate total charge (includes sticker + service fee + Stripe processing)
        const { total: totalAmount, serviceFee } = calculateTotalWithFees(stickerPrice);

        // Get payment method from Stripe customer
        const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id);

        if (!stripeCustomer || stripeCustomer.deleted) {
          throw new Error('Stripe customer not found');
        }

        // @ts-ignore - TypeScript doesn't know about invoice_settings
        const defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method;

        if (!defaultPaymentMethod) {
          throw new Error('No default payment method found for customer');
        }

        // Create payment intent
        // Customer pays: total amount (calculated to cover sticker + service fee + Stripe processing)
        // Remitter receives: exact sticker price (100% of what city requires)
        // Platform receives: service fee ($2.50) after Stripe takes their cut
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency: 'usd',
          customer: customer.stripe_customer_id,
          payment_method: defaultPaymentMethod as string,
          confirm: true,
          description: `City Sticker Renewal - ${customer.license_plate}`,
          metadata: {
            user_id: customer.user_id,
            license_plate: customer.license_plate,
            renewal_type: 'city_sticker',
            expiry_date: customer.city_sticker_expiry,
            sticker_price: stickerPrice.toString(),
            service_fee: serviceFee.toString(),
            total_charged: totalAmount.toString(),
          },

          // Send exact sticker price to remitter (100% of city sticker cost)
          transfer_data: {
            destination: remitter.stripe_connected_account_id,
            amount: Math.round(stickerPrice * 100), // Remitter gets exact sticker price
          },

          // Platform receives: totalAmount - stickerPrice - Stripe's processing fee = $2.50 service fee

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
          remitter_received_amount: stickerPrice, // Remitter gets 100% of sticker price
          platform_fee_amount: serviceFee, // $2.50 service fee
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
          service_fee: serviceFee, // Platform service fee ($2.50)
          total_amount: totalAmount, // Total customer was charged
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
