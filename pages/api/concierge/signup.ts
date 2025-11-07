/**
 * Concierge Service Signup API
 *
 * Processes customer signup:
 * 1. Create Stripe Customer
 * 2. Attach payment method
 * 3. Charge $12-15 one-time to remitter (via Stripe Connect)
 * 4. Create $12/mo subscription to platform
 * 5. Save customer data and payment authorization
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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      licensePlate,
      licenseState,
      streetAddress,
      city,
      state,
      zipCode,
      cityStickerExpiry,
      licensePlateExpiry,
      paymentMethodId,
    } = req.body;

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !licensePlate || !cityStickerExpiry || !paymentMethodId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 1. Create Stripe Customer
    const customer = await stripe.customers.create({
      name: `${firstName} ${lastName}`,
      email,
      phone,
      address: {
        line1: streetAddress,
        city,
        state,
        postal_code: zipCode,
      },
      metadata: {
        license_plate: licensePlate,
        license_state: licenseState,
      },
    });

    // 2. Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // 3. Get default remitter for one-time charge
    // TODO: This should be assigned based on customer's location/zip code
    const { data: remitter } = await supabase
      .from('renewal_partners')
      .select('*')
      .eq('status', 'active')
      .single();

    if (!remitter || !remitter.stripe_connected_account_id) {
      console.warn('No active remitter found with connected account');
      // Continue anyway - don't block signup if no remitter available yet
    }

    // 4. Charge one-time setup fee to remitter (if remitter available)
    let remitterCharge = null;
    const REMITTER_FEE = 1500; // $15.00

    if (remitter?.stripe_connected_account_id) {
      try {
        remitterCharge = await stripe.paymentIntents.create({
          amount: REMITTER_FEE,
          currency: 'usd',
          customer: customer.id,
          payment_method: paymentMethodId,
          confirm: true,
          description: 'Concierge Service - Initial Setup Fee',

          // Send to remitter's account
          transfer_data: {
            destination: remitter.stripe_connected_account_id,
          },

          // No platform fee on setup charge
          application_fee_amount: 0,
        });

        // Log remitter charge in database
        await supabase.from('renewal_charges').insert({
          charge_type: 'remitter_onetime',
          amount: REMITTER_FEE / 100,
          stripe_payment_intent_id: remitterCharge.id,
          status: 'succeeded',
          remitter_partner_id: remitter.id,
          remitter_received_amount: REMITTER_FEE / 100,
          platform_fee_amount: 0,
          succeeded_at: new Date().toISOString(),
        });

      } catch (remitterError: any) {
        console.error('Remitter charge failed:', remitterError);
        // Don't block signup if remitter charge fails
        // Customer service can handle this manually
      }
    }

    // 5. Create $12/mo subscription to platform
    const subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Autopilot Concierge Service',
              description: 'Automated city sticker and license plate renewals',
            },
            unit_amount: 1200, // $12.00
            recurring: {
              interval: 'month',
            },
          },
        },
      ],
      default_payment_method: paymentMethodId,
      metadata: {
        service: 'concierge',
        license_plate: licensePlate,
      },
    });

    // 6. Create user in Supabase Auth (if doesn't exist)
    // For now, we'll create an anonymous user profile without auth
    // TODO: Add proper authentication flow if needed

    // Create user profile with subscription info
    const { data: profile, error: profileError } = await supabase
      .from('user_profiles')
      .insert({
        first_name: firstName,
        last_name: lastName,
        license_plate: licensePlate,
        license_state: licenseState,
        zip_code: zipCode,
        street_address: streetAddress,
        mailing_city: city,
        mailing_state: state,
        mailing_zip: zipCode,
        city_sticker_expiry: cityStickerExpiry,
        license_plate_expiry: licensePlateExpiry || null,
        concierge_service: true,
        stripe_customer_id: customer.id,
        stripe_payment_method_id: paymentMethodId,
        stripe_subscription_id: subscription.id,
        subscription_status: subscription.status,
        subscription_started_at: new Date().toISOString(),
        payment_authorized_at: new Date().toISOString(),
        renewal_notification_days: 30, // Default: charge 30 days before expiration
      })
      .select()
      .single();

    if (profileError) {
      console.error('Profile creation error:', profileError);
      // Cancel subscription if profile creation fails
      await stripe.subscriptions.cancel(subscription.id);
      throw new Error('Failed to create user profile');
    }

    // 7. Log subscription charge
    await supabase.from('renewal_charges').insert({
      charge_type: 'subscription',
      amount: 12,
      stripe_subscription_id: subscription.id,
      stripe_invoice_id: subscription.latest_invoice as string,
      status: 'succeeded',
      succeeded_at: new Date().toISOString(),
    });

    // 8. Send welcome email (TODO: implement)
    // await sendWelcomeEmail(email, firstName);

    return res.status(200).json({
      success: true,
      message: 'Signup successful!',
      customer: {
        id: customer.id,
        email: customer.email,
      },
      subscription: {
        id: subscription.id,
        status: subscription.status,
        current_period_end: subscription.current_period_end,
      },
      profile: {
        id: profile.user_id,
      },
    });

  } catch (error: any) {
    console.error('Signup error:', error);

    return res.status(500).json({
      error: error.message || 'Signup failed',
      details: error.raw?.message,
    });
  }
}
