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
import { sendClickSendSMS } from '../../../lib/sms-service';
import { PLATFORM_FEES, STRIPE_FEES } from '../../../lib/pricing-config';

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

// Use centralized pricing constants
const { PERCENTAGE_FEE: STRIPE_PERCENTAGE_FEE, FIXED_FEE: STRIPE_FIXED_FEE } = STRIPE_FEES;
const { SERVICE_FEE, REMITTER_SERVICE_FEE, PERMIT_FEE } = PLATFORM_FEES;

/**
 * Get the next available remitter using load balancing
 * Selects the active remitter with the fewest pending orders
 */
async function getNextAvailableRemitter(): Promise<any> {
  // Get all active remitters with valid Stripe accounts
  const { data: remitters, error } = await supabase
    .from('renewal_partners')
    .select('*')
    .eq('status', 'active')
    .not('stripe_connected_account_id', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch remitters: ${error.message}`);
  }

  if (!remitters || remitters.length === 0) {
    throw new Error('No active remitters available');
  }

  // If only one remitter, return it immediately
  if (remitters.length === 1) {
    return remitters[0];
  }

  // Get pending order counts for ALL remitters in a single query (avoids N+1)
  const remitterIds = remitters.map(r => r.id);
  const { data: orderCounts, error: countError } = await supabase
    .from('renewal_orders')
    .select('partner_id')
    .in('partner_id', remitterIds)
    .in('status', ['pending', 'processing']);

  if (countError) {
    console.warn('Failed to fetch order counts:', countError.message);
  }

  // Count orders per partner from the single query result
  const remitterOrderCounts: Map<string, number> = new Map();
  for (const remitterId of remitterIds) {
    remitterOrderCounts.set(remitterId, 0);
  }
  for (const order of orderCounts || []) {
    const currentCount = remitterOrderCounts.get(order.partner_id) || 0;
    remitterOrderCounts.set(order.partner_id, currentCount + 1);
  }

  // Sort remitters by pending order count (ascending) and pick the one with fewest
  const sortedRemitters = remitters.sort((a, b) => {
    const countA = remitterOrderCounts.get(a.id) || 0;
    const countB = remitterOrderCounts.get(b.id) || 0;
    return countA - countB;
  });

  const selectedRemitter = sortedRemitters[0];
  const pendingCount = remitterOrderCounts.get(selectedRemitter.id) || 0;

  console.log(`🔄 Load balancing: Selected remitter "${selectedRemitter.name}" (${pendingCount} pending orders)`);
  console.log(`   All remitters: ${remitters.map(r => `${r.name}:${remitterOrderCounts.get(r.id)}`).join(', ')}`);

  return selectedRemitter;
}

/**
 * Send email via Resend
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <alerts@autopilotamerica.com>',
        to: [to],
        subject,
        html,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

/**
 * Send charge success email to customer
 */
async function sendChargeSuccessEmail(customer: any, amount: number, renewalType: string): Promise<void> {
  const email = customer.email;
  if (!email) return;

  const typeName = renewalType === 'city_sticker' ? 'city sticker' : 'license plate';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">Your ${typeName} renewal has been processed</h1>
      </div>
      <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
        <p>Hi ${customer.first_name || 'there'},</p>
        <p>Great news! We've successfully charged your card for your ${typeName} renewal.</p>

        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #6b7280;">Amount charged:</span>
            <strong>$${amount.toFixed(2)}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
            <span style="color: #6b7280;">License plate:</span>
            <strong>${customer.license_plate}</strong>
          </div>
          <div style="display: flex; justify-content: space-between;">
            <span style="color: #6b7280;">Expiration date:</span>
            <strong>${customer.city_sticker_expiry || customer.license_plate_expiry}</strong>
          </div>
        </div>

        <p><strong>What's next?</strong></p>
        <ol>
          <li>We'll submit your renewal to the city within 1-2 business days</li>
          <li>Your new sticker will be mailed to your address on file</li>
          <li>You'll receive a confirmation email when it's complete</li>
        </ol>

        <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
          Questions? Reply to this email or contact support@autopilotamerica.com
        </p>
      </div>
    </div>
  `;

  await sendEmail(email, `Your ${typeName} renewal has been processed - $${amount.toFixed(2)}`, html);
  console.log(`📧 Sent charge success email to ${email}`);
}

/**
 * Send new order alert to remitter
 */
async function sendRemitterAlert(remitter: any, customer: any, stickerPrice: number, serviceFee: number): Promise<void> {
  const email = remitter.email;
  if (!email) return;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px;">New City Sticker Order!</h1>
      </div>
      <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
        <p>Hi ${remitter.name},</p>
        <p>You have a new city sticker order ready for processing.</p>

        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #111827;">Customer Details</h3>
          <div style="line-height: 1.8;">
            <div><strong>Name:</strong> ${customer.first_name} ${customer.last_name}</div>
            <div><strong>License Plate:</strong> ${customer.license_plate}</div>
            <div><strong>Address:</strong> ${customer.street_address}</div>
            <div><strong>Due Date:</strong> ${customer.city_sticker_expiry}</div>
          </div>
        </div>

        <div style="background: #d1fae5; border: 1px solid #10b981; border-radius: 8px; padding: 16px; margin: 16px 0;">
          <h3 style="margin-top: 0; color: #065f46;">Payment Details</h3>
          <div style="line-height: 1.8;">
            <div><strong>Sticker Price:</strong> $${stickerPrice.toFixed(2)}</div>
            <div><strong>Processing Fee:</strong> $${serviceFee.toFixed(2)}</div>
            <div><strong>Total You Receive:</strong> $${(stickerPrice + serviceFee).toFixed(2)}</div>
          </div>
        </div>

        <p><strong>Action Required:</strong></p>
        <ol>
          <li>Submit renewal to city portal</li>
          <li>Record confirmation number</li>
          <li>Confirm payment via API or admin dashboard</li>
        </ol>

        <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
          View all pending orders at your dashboard.
        </p>
      </div>
    </div>
  `;

  await sendEmail(email, `New City Sticker Order - ${customer.license_plate}`, html);
  console.log(`📧 Sent new order alert to remitter ${email}`);
}

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
  // Verify this is a cron request (skip auth for dry run testing)
  const dryRun = req.query.dryRun === 'true';
  const authHeader = req.headers.authorization;

  if (!dryRun && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`🔄 Starting unified renewal processing...${dryRun ? ' [DRY RUN - no charges will be made]' : ''}`);

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

        // Get next available remitter using load balancing
        const remitter = await getNextAvailableRemitter();

        // Fetch price from Stripe
        const vehicleType = customer.vehicle_type || 'P';
        const stickerPrice = await getStickerPrice(vehicleType);

        // Check if customer needs permit (in permit zone AND opted in)
        const needsPermit = customer.has_permit_zone === true && customer.permit_requested === true;
        const permitFee = needsPermit ? PERMIT_FEE : 0;

        // Calculate total: sticker + permit (if applicable)
        const basePrice = stickerPrice + permitFee;
        const { total: totalAmount, serviceFee } = calculateTotalWithFees(basePrice);

        // Get payment method - check customer default first, then subscription default
        const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id);

        if (!stripeCustomer || stripeCustomer.deleted) {
          throw new Error('Stripe customer not found');
        }

        // @ts-ignore
        let defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method;

        // If no default on customer, check their active subscription
        if (!defaultPaymentMethod) {
          console.log(`No customer default PM, checking subscriptions for ${customer.email}...`);
          const subscriptions = await stripe.subscriptions.list({
            customer: customer.stripe_customer_id,
            status: 'active',
            limit: 1,
          });

          if (subscriptions.data.length > 0) {
            const subscription = subscriptions.data[0];
            defaultPaymentMethod = subscription.default_payment_method as string;
            console.log(`Found subscription default PM: ${defaultPaymentMethod}`);

            // Also set it as customer default for future charges
            if (defaultPaymentMethod) {
              await stripe.customers.update(customer.stripe_customer_id, {
                invoice_settings: {
                  default_payment_method: defaultPaymentMethod,
                },
              });
              console.log(`✅ Updated customer default PM to: ${defaultPaymentMethod}`);
            }
          }
        }

        if (!defaultPaymentMethod) {
          throw new Error('No default payment method found on customer or subscription');
        }

        // DRY RUN: Log what would happen but don't actually charge
        if (dryRun) {
          console.log(`🧪 [DRY RUN] Would charge customer ${customer.email}:`);
          console.log(`   - Amount: $${totalAmount.toFixed(2)}`);
          console.log(`   - Sticker price: $${stickerPrice.toFixed(2)}`);
          if (needsPermit) {
            console.log(`   - Permit fee: $${permitFee.toFixed(2)}`);
          }
          console.log(`   - Service fee: $${serviceFee.toFixed(2)}`);
          console.log(`   - Remitter: ${remitter.name} (${remitter.stripe_connected_account_id})`);
          console.log(`   - Remitter would receive: $${(stickerPrice + permitFee + REMITTER_SERVICE_FEE).toFixed(2)}`);
          console.log(`   - Payment method: ${defaultPaymentMethod}`);
          results.cityStickerSucceeded++;
          continue;
        }

        // Create payment intent (off_session for merchant-initiated transaction)
        const renewalDescription = needsPermit
          ? `City Sticker + Permit Renewal - ${customer.license_plate}`
          : `City Sticker Renewal - ${customer.license_plate}`;

        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(totalAmount * 100),
          currency: 'usd',
          customer: customer.stripe_customer_id,
          payment_method: defaultPaymentMethod as string,
          off_session: true,  // Required for merchant-initiated charges without customer present
          confirm: true,
          description: renewalDescription,
          metadata: {
            user_id: customer.user_id,
            license_plate: customer.license_plate,
            renewal_type: 'city_sticker',
            expiry_date: customer.city_sticker_expiry,
            sticker_price: stickerPrice.toString(),
            permit_fee: permitFee.toString(),
            permit_requested: needsPermit.toString(),
            service_fee: serviceFee.toString(),
            total_charged: totalAmount.toString(),
          },
          transfer_data: {
            destination: remitter.stripe_connected_account_id,
            amount: Math.round((stickerPrice + permitFee) * 100), // Remitter gets sticker + permit price
          },
          receipt_email: customer.email || undefined,
        });

        // Send $12 service fee from platform balance to remitter
        // This comes from the $12/mo or $120/year collected in subscription
        // Non-blocking: if platform balance insufficient, log and continue
        let serviceFeeTransferId: string | null = null;
        try {
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
          serviceFeeTransferId = serviceFeeTransfer.id;
          console.log(`✅ Service fee transfer complete: ${serviceFeeTransfer.id}`);
        } catch (transferError: any) {
          // Log but don't fail - service fee can be transferred later when balance available
          console.warn(`⚠️ Service fee transfer skipped (insufficient platform balance): ${transferError.message}`);
          console.log(`   Will need to transfer $${REMITTER_SERVICE_FEE} to remitter manually or when balance available`);
        }

        // Log successful charge
        await supabase.from('renewal_charges').insert({
          user_id: customer.user_id,
          charge_type: 'sticker_renewal',
          amount: totalAmount,
          stripe_payment_intent_id: paymentIntent.id,
          stripe_charge_id: paymentIntent.latest_charge as string,
          status: 'succeeded',
          remitter_partner_id: remitter.id,
          remitter_received_amount: stickerPrice + permitFee + REMITTER_SERVICE_FEE, // Sticker + permit + $12 service fee
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
          customer_phone: customer.phone_number,
          license_plate: customer.license_plate,
          license_state: customer.license_state || 'IL',
          vin: customer.vin || null,
          make: customer.vehicle_make || null,
          model: customer.vehicle_model || null,
          year: customer.vehicle_year || null,
          street_address: customer.street_address,
          city: customer.mailing_city || 'Chicago',
          state: customer.mailing_state || 'IL',
          zip_code: customer.zip_code,
          sticker_type: vehicleType,
          sticker_price: stickerPrice,
          permit_fee: permitFee, // $30 if permit requested, $0 otherwise
          permit_requested: needsPermit,
          service_fee: REMITTER_SERVICE_FEE, // $12 processing fee to remitter
          total_amount: stickerPrice + permitFee + REMITTER_SERVICE_FEE, // Total remitter receives
          payment_status: 'paid',
          status: 'pending', // Awaiting remitter to process and submit to city
          stripe_payment_intent_id: paymentIntent.id,
          renewal_due_date: customer.city_sticker_expiry,
        });

        // Send email and SMS notifications
        try {
          // Email to customer
          await sendChargeSuccessEmail(customer, totalAmount, 'city_sticker');

          // SMS to customer (if phone number available)
          if (customer.phone_number) {
            const smsMessage = `Autopilot America: We've charged $${totalAmount.toFixed(2)} for your city sticker renewal (${customer.license_plate}). We'll submit it to the city and your new sticker will be mailed to you. Questions? Reply to this text.`;
            const smsResult = await sendClickSendSMS(customer.phone_number, smsMessage);
            if (smsResult.success) {
              console.log(`📱 SMS sent to ${customer.phone}`);
            } else {
              console.log(`⚠️ SMS failed for ${customer.phone}: ${smsResult.error}`);
            }
          }

          // Email to remitter
          await sendRemitterAlert(remitter, customer, stickerPrice, REMITTER_SERVICE_FEE);
        } catch (notificationError) {
          console.error('Failed to send notifications:', notificationError);
          // Don't fail the whole process for notification errors
        }

        results.cityStickerSucceeded++;
        const permitNote = needsPermit ? ` + $${permitFee} permit` : '';
        console.log(`✅ Renewal complete for ${customer.user_id}:
          - Customer charged: $${totalAmount}
          - Remitter received: $${(stickerPrice + permitFee + REMITTER_SERVICE_FEE).toFixed(2)} ($${stickerPrice} sticker${permitNote} + $${REMITTER_SERVICE_FEE} service)
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

        // Send failed payment notification to customer
        if (customer.email) {
          const failedHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 24px;">Payment Issue - Action Required</h1>
              </div>
              <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                <p>Hi ${customer.first_name || 'there'},</p>
                <p>We tried to process your city sticker renewal, but there was an issue with your payment method.</p>

                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <strong>License Plate:</strong> ${customer.license_plate}<br>
                  <strong>Due Date:</strong> ${customer.city_sticker_expiry}
                </div>

                <p><strong>To fix this:</strong></p>
                <ol>
                  <li>Log in at <a href="https://ticketlesschicago.com/settings">ticketlesschicago.com/settings</a></li>
                  <li>Update your payment method</li>
                  <li>We'll automatically retry your renewal</li>
                </ol>

                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  Need help? Reply to this email or contact support@autopilotamerica.com
                </p>
              </div>
            </div>
          `;
          await sendEmail(customer.email, 'Action Required: Update Your Payment Method', failedHtml);
          console.log(`📧 Sent payment failure email to ${customer.email}`);
        }

        results.cityStickerFailed++;
        results.errors.push({
          type: 'city_sticker',
          customer_id: customer.user_id,
          license_plate: customer.license_plate,
          error: error.message,
        });
      }
    }

    // ==========================================
    // LICENSE PLATE RENEWAL PROCESSING
    // ==========================================
    // CRITICAL: Must check emissions test status before processing
    // Illinois requires valid emissions test to renew license plates
    // ==========================================

    console.log('🚗 Processing license plate renewals...');

    // Get customers with license plates expiring in 0-30 days
    const { data: plateCustomers, error: plateError } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('has_protection', true)
      .not('license_plate_expiry', 'is', null)
      .not('stripe_customer_id', 'is', null);

    if (plateError) {
      console.error('Error fetching license plate customers:', plateError);
    } else {
      for (const customer of plateCustomers || []) {
        const plateExpiry = new Date(customer.license_plate_expiry);
        const today = new Date();
        const daysUntilExpiry = Math.floor((plateExpiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const notificationDays = customer.renewal_notification_days || 30;

        // Skip if not within processing window
        if (daysUntilExpiry > notificationDays || daysUntilExpiry < 0) {
          continue;
        }

        results.licensePlateProcessed++;

        // CRITICAL EMISSIONS CHECK
        // If emissions test is required and not completed, cannot process license plate renewal
        const emissionsRequired = customer.emissions_date !== null;
        const emissionsCompleted = customer.emissions_completed === true;

        if (emissionsRequired && !emissionsCompleted) {
          const emissionsDate = new Date(customer.emissions_date);
          const daysUntilEmissions = Math.floor((emissionsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          console.log(`⚠️ BLOCKED: Cannot process license plate renewal for ${customer.email}`);
          console.log(`   Reason: Emissions test not completed (due in ${daysUntilEmissions} days)`);
          console.log(`   Action: Sending urgent emissions reminder`);

          // Log the blocking for tracking
          await supabase.from('renewal_charges').insert({
            user_id: customer.user_id,
            charge_type: 'license_plate_renewal',
            amount: 0,
            status: 'blocked',
            failure_reason: 'Emissions test not completed - required for IL license plate renewal',
            failure_code: 'emissions_required',
            renewal_type: 'license_plate',
            renewal_due_date: customer.license_plate_expiry,
            failed_at: new Date().toISOString(),
          });

          results.licensePlateFailed++;
          results.errors.push({
            type: 'license_plate',
            customer_id: customer.user_id,
            license_plate: customer.license_plate,
            error: `Emissions test required but not completed (due: ${customer.emissions_date})`,
          });

          // Skip to next customer - cannot process without emissions
          continue;
        }

        // Check if already processed this renewal cycle
        const { data: existingCharge } = await supabase
          .from('renewal_charges')
          .select('*')
          .eq('user_id', customer.user_id)
          .eq('charge_type', 'license_plate_renewal')
          .eq('renewal_due_date', customer.license_plate_expiry)
          .eq('status', 'succeeded')
          .single();

        if (existingCharge) {
          console.log(`Already processed license plate renewal for customer ${customer.user_id}`);
          continue;
        }

        try {
          // Get next available remitter using load balancing
          const remitter = await getNextAvailableRemitter();

          // Fetch license plate price from Stripe
          const isVanity = customer.has_vanity_plate === true;
          const priceId = isVanity
            ? stripeConfig.licensePlateVanityPriceId
            : stripeConfig.licensePlatePriceId;

          if (!priceId) {
            throw new Error(`No Stripe price ID configured for license plate (vanity: ${isVanity})`);
          }

          const price = await stripe.prices.retrieve(priceId);
          if (!price.unit_amount) {
            throw new Error(`Stripe price ${priceId} has no unit_amount`);
          }
          const platePrice = price.unit_amount / 100;

          // Calculate total with fees
          const { total: totalAmount, serviceFee } = calculateTotalWithFees(platePrice);

          // Get payment method
          const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id);
          if (!stripeCustomer || stripeCustomer.deleted) {
            throw new Error('Stripe customer not found');
          }

          // @ts-ignore
          let defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method;

          if (!defaultPaymentMethod) {
            const subscriptions = await stripe.subscriptions.list({
              customer: customer.stripe_customer_id,
              status: 'active',
              limit: 1,
            });

            if (subscriptions.data.length > 0) {
              defaultPaymentMethod = subscriptions.data[0].default_payment_method as string;
            }
          }

          if (!defaultPaymentMethod) {
            throw new Error('No default payment method found');
          }

          // DRY RUN check
          if (dryRun) {
            console.log(`🧪 [DRY RUN] Would charge license plate for ${customer.email}:`);
            console.log(`   - Amount: $${totalAmount.toFixed(2)}`);
            console.log(`   - Plate price: $${platePrice.toFixed(2)}`);
            console.log(`   - Vanity: ${isVanity}`);
            results.licensePlateSucceeded++;
            continue;
          }

          // Create payment intent
          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(totalAmount * 100),
            currency: 'usd',
            customer: customer.stripe_customer_id,
            payment_method: defaultPaymentMethod as string,
            off_session: true,
            confirm: true,
            description: `License Plate Renewal - ${customer.license_plate}`,
            metadata: {
              user_id: customer.user_id,
              license_plate: customer.license_plate,
              renewal_type: 'license_plate',
              expiry_date: customer.license_plate_expiry,
              plate_price: platePrice.toString(),
              is_vanity: isVanity.toString(),
            },
            transfer_data: {
              destination: remitter.stripe_connected_account_id,
              amount: Math.round(platePrice * 100),
            },
            receipt_email: customer.email || undefined,
          });

          // Transfer $12 service fee (non-blocking)
          try {
            await stripe.transfers.create({
              amount: Math.round(REMITTER_SERVICE_FEE * 100),
              currency: 'usd',
              destination: remitter.stripe_connected_account_id,
              description: `License Plate Processing Fee - ${customer.license_plate}`,
              metadata: {
                user_id: customer.user_id,
                license_plate: customer.license_plate,
                renewal_type: 'license_plate',
                payment_intent_id: paymentIntent.id,
              },
            });
            console.log(`✅ Service fee transfer complete for license plate`);
          } catch (transferError: any) {
            console.warn(`⚠️ Service fee transfer skipped: ${transferError.message}`);
          }

          // Log successful charge
          await supabase.from('renewal_charges').insert({
            user_id: customer.user_id,
            charge_type: 'license_plate_renewal',
            amount: totalAmount,
            stripe_payment_intent_id: paymentIntent.id,
            stripe_charge_id: paymentIntent.latest_charge as string,
            status: 'succeeded',
            remitter_partner_id: remitter.id,
            remitter_received_amount: platePrice + REMITTER_SERVICE_FEE,
            platform_fee_amount: serviceFee,
            renewal_type: 'license_plate',
            renewal_due_date: customer.license_plate_expiry,
            succeeded_at: new Date().toISOString(),
          });

          // Create order for remitter
          await supabase.from('renewal_orders').insert({
            order_number: 'LP-' + Date.now(),
            partner_id: remitter.id,
            customer_name: `${customer.first_name} ${customer.last_name}`,
            customer_email: customer.email,
            customer_phone: customer.phone_number,
            license_plate: customer.license_plate,
            license_state: customer.license_state || 'IL',
            vin: customer.vin || null,
            make: customer.vehicle_make || null,
            model: customer.vehicle_model || null,
            year: customer.vehicle_year || null,
            street_address: customer.street_address,
            city: customer.mailing_city || 'Chicago',
            state: customer.mailing_state || 'IL',
            zip_code: customer.zip_code,
            sticker_type: isVanity ? 'vanity' : 'standard',
            sticker_price: platePrice,
            service_fee: REMITTER_SERVICE_FEE,
            total_amount: platePrice + REMITTER_SERVICE_FEE,
            payment_status: 'paid',
            status: 'pending',
            stripe_payment_intent_id: paymentIntent.id,
            renewal_due_date: customer.license_plate_expiry,
          });

          // Send notifications
          try {
            await sendChargeSuccessEmail(customer, totalAmount, 'license_plate');

            if (customer.phone_number) {
              const smsMessage = `Autopilot America: We've charged $${totalAmount.toFixed(2)} for your license plate renewal (${customer.license_plate}). We'll submit it to the IL SOS and your new sticker will be mailed. Questions? Reply to this text.`;
              await sendClickSendSMS(customer.phone_number, smsMessage);
            }

            await sendRemitterAlert(remitter, customer, platePrice, REMITTER_SERVICE_FEE);
          } catch (notificationError) {
            console.error('Failed to send license plate notifications:', notificationError);
          }

          results.licensePlateSucceeded++;
          console.log(`✅ License plate renewal complete for ${customer.user_id}: $${totalAmount}`);

        } catch (error: any) {
          console.error(`Failed to process license plate for ${customer.user_id}:`, error.message);

          await supabase.from('renewal_charges').insert({
            user_id: customer.user_id,
            charge_type: 'license_plate_renewal',
            amount: 0,
            status: 'failed',
            failure_reason: error.message,
            renewal_type: 'license_plate',
            renewal_due_date: customer.license_plate_expiry,
            failed_at: new Date().toISOString(),
          });

          results.licensePlateFailed++;
          results.errors.push({
            type: 'license_plate',
            customer_id: customer.user_id,
            license_plate: customer.license_plate,
            error: error.message,
          });
        }
      }
    }

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
