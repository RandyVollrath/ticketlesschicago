import type { NextApiRequest, NextApiResponse } from 'next';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { fetchWithTimeout, DEFAULT_TIMEOUTS } from '../../../lib/fetch-with-timeout';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-11-20.acacia'
});

// Define renewal fees
const RENEWAL_FEES = {
  city_sticker: {
    PA: 94.80, // Passenger Auto
    PB: 189.60, // Large Passenger
    SB: 266.40, // Small Business/Motorcycle
    MT: 398.40, // Medium Truck
    LT: 530.40  // Large Truck
  },
  license_plate: {
    standard: 155,
    vanity: 164
  },
  permit: 30
};

// Input validation schema
const chargeRenewalSchema = z.object({
  userId: z.string().uuid('Invalid user ID format'),
  chargeType: z.enum(['city_sticker', 'license_plate', 'permit'], {
    errorMap: () => ({ message: 'Invalid charge type' })
  }),
  vehicleType: z.string().max(10).optional(),
  isVanity: z.boolean().optional(),
  licensePlate: z.string().min(2).max(10).regex(/^[A-Z0-9\-\s]+$/i, 'Invalid license plate').transform(val => val.toUpperCase().trim()),
  renewalDeadline: z.string().refine(val => !isNaN(Date.parse(val)), 'Invalid date format'),
});

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify this is being called by cron or admin (check authorization header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Validate request body
  const parseResult = chargeRenewalSchema.safeParse(req.body);
  if (!parseResult.success) {
    const errors = parseResult.error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { userId, chargeType, vehicleType, isVanity, licensePlate, renewalDeadline } = parseResult.data;

  try {
    // Calculate amount based on charge type
    let amount = 0;
    if (chargeType === 'city_sticker') {
      if (!vehicleType || !(vehicleType in RENEWAL_FEES.city_sticker)) {
        return res.status(400).json({ error: 'Invalid or missing vehicle type for city sticker' });
      }
      amount = RENEWAL_FEES.city_sticker[vehicleType as keyof typeof RENEWAL_FEES.city_sticker];
    } else if (chargeType === 'license_plate') {
      amount = isVanity ? RENEWAL_FEES.license_plate.vanity : RENEWAL_FEES.license_plate.standard;
    } else if (chargeType === 'permit') {
      amount = RENEWAL_FEES.permit;
    }

    // Get user's Stripe customer ID from user_profiles
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id, email, first_name')
      .eq('user_id', userId)
      .single();

    if (profileError || !profile) {
      console.error('Failed to get user profile:', profileError);
      return res.status(404).json({ error: 'User profile not found' });
    }

    if (!profile.stripe_customer_id) {
      console.error('User has no Stripe customer ID:', userId);
      return res.status(400).json({ error: 'User has no payment method on file' });
    }

    // Calculate total with Stripe fee (2.9% + $0.30)
    const stripeFee = (amount * 0.029) + 0.30;
    const totalCharged = amount + stripeFee;

    // Create pending charge record first
    const { data: chargeRecord, error: chargeRecordError } = await supabase
      .from('renewal_charges')
      .insert({
        user_id: userId,
        charge_type: chargeType,
        amount: amount,
        stripe_fee: stripeFee,
        total_charged: totalCharged,
        vehicle_type: vehicleType || null,
        license_plate: licensePlate,
        renewal_deadline: renewalDeadline,
        status: 'pending'
      })
      .select()
      .single();

    if (chargeRecordError || !chargeRecord) {
      console.error('Failed to create charge record:', chargeRecordError);
      return res.status(500).json({ error: 'Failed to create charge record' });
    }

    console.log(`💳 Created pending charge record ${chargeRecord.id} for user ${userId}`);

    // Attempt to charge the card via Stripe
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalCharged * 100), // Convert to cents
        currency: 'usd',
        customer: profile.stripe_customer_id,
        off_session: true, // Charge without customer present
        confirm: true, // Immediately confirm the payment
        description: `${chargeType.replace('_', ' ')} renewal for ${licensePlate}`,
        metadata: {
          user_id: userId,
          charge_type: chargeType,
          license_plate: licensePlate,
          renewal_deadline: renewalDeadline,
          charge_record_id: chargeRecord.id
        }
      });

      if (paymentIntent.status === 'succeeded') {
        // Update charge record to 'charged'
        const { error: updateError } = await supabase
          .from('renewal_charges')
          .update({
            status: 'charged',
            stripe_payment_intent_id: paymentIntent.id,
            stripe_charge_id: paymentIntent.latest_charge as string,
            charged_at: new Date().toISOString()
          })
          .eq('id', chargeRecord.id);

        if (updateError) {
          console.error('Failed to update charge record after success:', updateError);
        }

        console.log(`✅ Successfully charged $${totalCharged.toFixed(2)} to user ${userId}`);

        // Send confirmation email (non-blocking)
        sendChargeConfirmationEmail(
          profile.email,
          profile.first_name,
          chargeType,
          amount,
          stripeFee,
          licensePlate,
          renewalDeadline
        ).catch(err => console.error('Failed to send confirmation email:', err));

        return res.status(200).json({
          success: true,
          chargeId: chargeRecord.id,
          amountCharged: totalCharged,
          paymentIntentId: paymentIntent.id
        });

      } else {
        // Payment requires action (e.g., 3D Secure) - mark as failed for now
        const { error: updateError } = await supabase
          .from('renewal_charges')
          .update({
            status: 'failed',
            stripe_payment_intent_id: paymentIntent.id,
            error_message: `Payment requires additional action: ${paymentIntent.status}`
          })
          .eq('id', chargeRecord.id);

        console.error(`❌ Payment requires action for user ${userId}: ${paymentIntent.status}`);

        return res.status(400).json({
          error: 'Payment requires additional authentication',
          paymentIntentId: paymentIntent.id
        });
      }

    } catch (stripeError: any) {
      // Stripe charge failed - update record
      const { error: updateError } = await supabase
        .from('renewal_charges')
        .update({
          status: 'failed',
          error_message: stripeError.message,
          retry_count: chargeRecord.retry_count + 1,
          last_retry_at: new Date().toISOString()
        })
        .eq('id', chargeRecord.id);

      console.error(`❌ Stripe charge failed for user ${userId}:`, stripeError.message);

      // Send payment failure email to user
      sendPaymentFailureEmail(
        profile.email,
        profile.first_name,
        chargeType,
        amount,
        licensePlate
      ).catch(err => console.error('Failed to send failure email:', err));

      return res.status(500).json({
        error: 'Payment failed',
        message: stripeError.message,
        chargeId: chargeRecord.id
      });
    }

  } catch (error: any) {
    console.error('Renewal charge error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

// Send confirmation email after successful charge
async function sendChargeConfirmationEmail(
  email: string,
  firstName: string,
  chargeType: string,
  amount: number,
  stripeFee: number,
  licensePlate: string,
  renewalDeadline: string
) {
  const chargeTypeLabel = chargeType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    timeout: DEFAULT_TIMEOUTS.email,
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: email,
      subject: `Payment Confirmation: ${chargeTypeLabel} Renewal`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a;">Payment Confirmation</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Hi ${firstName},
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            We've successfully charged your card for your upcoming <strong>${chargeTypeLabel}</strong> renewal.
          </p>

          <div style="background-color: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <h3 style="margin-top: 0; color: #1a1a1a;">Charge Details</h3>
            <table style="width: 100%; font-size: 15px;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">License Plate:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${licensePlate}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Renewal Type:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600;">${chargeTypeLabel}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Government Fee:</td>
                <td style="padding: 8px 0; text-align: right;">$${amount.toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Processing Fee:</td>
                <td style="padding: 8px 0; text-align: right;">$${stripeFee.toFixed(2)}</td>
              </tr>
              <tr style="border-top: 2px solid #e5e7eb;">
                <td style="padding: 8px 0; color: #1a1a1a; font-weight: 600;">Total Charged:</td>
                <td style="padding: 8px 0; text-align: right; font-weight: 600; font-size: 18px; color: #0052cc;">$${(amount + stripeFee).toFixed(2)}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280;">Renewal Deadline:</td>
                <td style="padding: 8px 0; text-align: right;">${new Date(renewalDeadline).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</td>
              </tr>
            </table>
          </div>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            We'll now file this renewal with the city/state on your behalf through our remitter service. You don't need to do anything else!
          </p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px;">
            Questions? Email us at <a href="mailto:support@autopilotamerica.com" style="color: #0052cc;">support@autopilotamerica.com</a>
          </p>

          <p style="color: #9ca3af; font-size: 12px;">
            Autopilot America • Never get another parking ticket
          </p>
        </div>
      `
    })
  });

  if (!response.ok) {
    throw new Error(`Resend API error: ${response.status}`);
  }

  console.log(`📧 Charge confirmation email sent to ${email}`);
}

// Send failure email if payment fails
async function sendPaymentFailureEmail(
  email: string,
  firstName: string,
  chargeType: string,
  amount: number,
  licensePlate: string
) {
  const chargeTypeLabel = chargeType.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());

  const response = await fetchWithTimeout('https://api.resend.com/emails', {
    method: 'POST',
    timeout: DEFAULT_TIMEOUTS.email,
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Autopilot America <alerts@autopilotamerica.com>',
      to: email,
      subject: `⚠️ Payment Failed: ${chargeTypeLabel} Renewal`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #dc2626;">Payment Failed</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Hi ${firstName},
          </p>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            We attempted to charge your card for your upcoming <strong>${chargeTypeLabel}</strong> renewal for <strong>${licensePlate}</strong>, but the payment failed.
          </p>

          <div style="background-color: #fef2f2; border: 2px solid #fca5a5; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <p style="margin: 0; color: #991b1b; font-weight: 600;">
              Amount: $${amount.toFixed(2)}
            </p>
            <p style="margin: 8px 0 0 0; color: #991b1b; font-size: 14px;">
              Please update your payment method to avoid late fees.
            </p>
          </div>

          <div style="margin: 32px 0; text-align: center;">
            <a href="${process.env.NEXT_PUBLIC_SITE_URL}/settings?tab=billing"
               style="background-color: #0052cc;
                      color: white;
                      padding: 14px 32px;
                      text-decoration: none;
                      border-radius: 8px;
                      font-weight: 600;
                      font-size: 16px;
                      display: inline-block;">
              Update Payment Method
            </a>
          </div>

          <p style="color: #374151; font-size: 14px; line-height: 1.6;">
            Common reasons for payment failure:
          </p>
          <ul style="color: #374151; font-size: 14px; line-height: 1.6;">
            <li>Expired card</li>
            <li>Insufficient funds</li>
            <li>Card blocked by your bank</li>
          </ul>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px;">
            Questions? Email us at <a href="mailto:support@autopilotamerica.com" style="color: #0052cc;">support@autopilotamerica.com</a>
          </p>
        </div>
      `
    })
  });

  if (!response.ok) {
    throw new Error(`Resend API error: ${response.status}`);
  }

  console.log(`📧 Payment failure email sent to ${email}`);
}
