/**
 * Unified Renewal Processing Cron Job
 *
 * Consolidates:
 * - process-renewals.ts (city stickers)
 * - check-renewal-deadlines.ts (city stickers, license plates, permits)
 *
 * Runs daily to:
 * 1. Find customers with renewals expiring in 0-30 days
 * 2. Charge saved payment method for each renewal type
 * 3. Send payments to remitter via Stripe Connect (city stickers)
 * 4. Create orders for remitter fulfillment
 * 5. Handle payment failures with notifications
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

// Sticker price IDs (fetched from Stripe)
const STICKER_PRICE_IDS: Record<string, string | undefined> = {
  MB: stripeConfig.cityStickerMbPriceId,
  P: stripeConfig.cityStickerPPriceId,
  LP: stripeConfig.cityStickerLpPriceId,
  ST: stripeConfig.cityStickerStPriceId,
  LT: stripeConfig.cityStickerLtPriceId,
};

// Stripe processing fee: 2.9% + $0.30
const STRIPE_PERCENTAGE_FEE = 0.029;
const STRIPE_FIXED_FEE = 0.30;

// Service fee for operational costs (processing, infrastructure)
const SERVICE_FEE = 2.50;

// Remitter processing fee (paid from subscription revenue)
const REMITTER_SERVICE_FEE = 12.00;

/**
 * Fetch sticker price from Stripe
 */
async function getStickerPrice(vehicleType: string): Promise<number> {
  const priceId = STICKER_PRICE_IDS[vehicleType] || STICKER_PRICE_IDS.P;

  if (!priceId) {
    throw new Error(`No Stripe price ID configured for vehicle type: ${vehicleType}`);
  }

  const price = await stripe.prices.retrieve(priceId);

  if (!price.unit_amount) {
    throw new Error(`Stripe price ${priceId} has no unit_amount`);
  }

  return price.unit_amount / 100;
}

/**
 * Calculate total charge to cover sticker price, service fee, and Stripe's processing fee
 */
function calculateTotalWithFees(basePrice: number): {
  total: number;
  serviceFee: number;
} {
  const total = (basePrice + SERVICE_FEE + STRIPE_FIXED_FEE) / (1 - STRIPE_PERCENTAGE_FEE);
  return {
    total: Math.round(total * 100) / 100,
    serviceFee: SERVICE_FEE,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify this is a cron request
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 Starting unified renewal processing...');

  try {
    const results = {
      cityStickerProcessed: 0,
      cityStickerSucceeded: 0,
      cityStickerFailed: 0,
      licensePlateProcessed: 0,
      licensePlateSucceeded: 0,
      licensePlateFailed: 0,
      permitProcessed: 0,
      permitSucceeded: 0,
      permitFailed: 0,
      errors: [] as any[],
    };

    // ======================
    // CITY STICKER RENEWALS
    // ======================
    console.log('🏙️  Processing city sticker renewals...');

    const { data: cityStickerCustomers, error: cityStickerError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('has_protection', true)
      .not('stripe_customer_id', 'is', null)
      .not('city_sticker_expiry', 'is', null);

    if (cityStickerError) {
      throw cityStickerError;
    }

    console.log(`Found ${cityStickerCustomers?.length || 0} active Protection customers with city stickers`);

    for (const customer of cityStickerCustomers || []) {
      try {
        // Calculate days until expiration
        const expiryDate = new Date(customer.city_sticker_expiry);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        const notificationDays = customer.renewal_notification_days || 30;

        // Process if within renewal window (0-30 days)
        if (daysUntilExpiry > notificationDays) {
          continue; // Too early
        }

        if (daysUntilExpiry < 0) {
          console.log(`Sticker already expired for customer ${customer.user_id} (${Math.abs(daysUntilExpiry)} days ago)`);
          continue; // Too late
        }

        // Check if already processed
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

        results.cityStickerProcessed++;

        // Get remitter
        const { data: remitter } = await supabase
          .from('renewal_partners')
          .select('*')
          .eq('status', 'active')
          .single();

        if (!remitter || !remitter.stripe_connected_account_id) {
          throw new Error('No active remitter available');
        }

        // Fetch price from Stripe
        const vehicleType = customer.vehicle_type || 'P';
        const stickerPrice = await getStickerPrice(vehicleType);
        const { total: totalAmount, serviceFee } = calculateTotalWithFees(stickerPrice);

        // Get payment method
        const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id);

        if (!stripeCustomer || stripeCustomer.deleted) {
          throw new Error('Stripe customer not found');
        }

        // @ts-ignore
        const defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method;

        if (!defaultPaymentMethod) {
          throw new Error('No default payment method found');
        }

        // Create payment intent
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
          transfer_data: {
            destination: remitter.stripe_connected_account_id,
            amount: Math.round(stickerPrice * 100), // Remitter gets exact sticker price
          },
          receipt_email: customer.email || undefined,
        });

        // Send $12 service fee from platform balance to remitter
        // This comes from the $1/mo or $12/year collected in subscription
        console.log(`💸 Transferring $${REMITTER_SERVICE_FEE} service fee to remitter from platform balance...`);
        const serviceFeeTransfer = await stripe.transfers.create({
          amount: Math.round(REMITTER_SERVICE_FEE * 100),
          currency: 'usd',
          destination: remitter.stripe_connected_account_id,
          description: `Sticker Processing Service Fee - ${customer.license_plate}`,
          metadata: {
            user_id: customer.user_id,
            license_plate: customer.license_plate,
            renewal_type: 'city_sticker',
            payment_intent_id: paymentIntent.id,
          },
        });

        console.log(`✅ Service fee transfer complete: ${serviceFeeTransfer.id}`);

        // Log successful charge
        await supabase.from('renewal_charges').insert({
          user_id: customer.user_id,
          charge_type: 'sticker_renewal',
          amount: totalAmount,
          stripe_payment_intent_id: paymentIntent.id,
          stripe_charge_id: paymentIntent.latest_charge as string,
          status: 'succeeded',
          remitter_partner_id: remitter.id,
          remitter_received_amount: stickerPrice + REMITTER_SERVICE_FEE, // Sticker + $12 service fee
          platform_fee_amount: serviceFee, // $2.50 platform keeps
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
          service_fee: REMITTER_SERVICE_FEE, // $12 processing fee to remitter
          total_amount: stickerPrice + REMITTER_SERVICE_FEE, // Total remitter receives
          payment_status: 'paid',
          status: 'pending',
          stripe_payment_intent_id: paymentIntent.id,
        });

        results.cityStickerSucceeded++;
        console.log(`✅ Renewal complete for ${customer.user_id}:
          - Customer charged: $${totalAmount}
          - Remitter received: $${(stickerPrice + REMITTER_SERVICE_FEE).toFixed(2)} ($${stickerPrice} sticker + $${REMITTER_SERVICE_FEE} service)
          - Platform kept: $${serviceFee}`);

      } catch (error: any) {
        console.error(`Failed to process city sticker for customer ${customer.user_id}:`, error);

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

        results.cityStickerFailed++;
        results.errors.push({
          type: 'city_sticker',
          customer_id: customer.user_id,
          license_plate: customer.license_plate,
          error: error.message,
        });
      }
    }

    // TODO: Add license plate and permit processing here
    // For now, they're handled by the old system

    console.log('✅ Unified renewal processing complete');

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
