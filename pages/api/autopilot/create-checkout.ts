import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { ACTIVE_AUTOPILOT_PLAN, AUTOPILOT_PRICE_ID } from '../../../lib/autopilot-plans';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20',
});

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // SECURITY: Authenticate the caller and use their verified user ID
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const { data: { user: authUser }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authUser) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const userId = authUser.id;

    const { licensePlate, plateState } = req.body;

    if (!licensePlate) {
      return res.status(400).json({ error: 'License plate required' });
    }

    // Sanitize inputs
    const cleanPlate = String(licensePlate).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const cleanState = String(plateState || 'IL').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'IL';

    // Get user email from Supabase
    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);

    if (userError || !userData?.user?.email) {
      return res.status(400).json({ error: 'User not found' });
    }

    const email = userData.user.email;

    // Check if user already has a Stripe customer
    const { data: existingSub } = await supabaseAdmin
      .from('autopilot_subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;

    // Create or retrieve Stripe customer
    if (!customerId) {
      // Check if customer already exists in Stripe by email (canonical check)
      const existingCustomers = await stripe.customers.list({
        email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        customerId = existingCustomers.data[0].id;
      } else {
        // Use idempotency key tied to user ID to prevent duplicate customer creation
        // from concurrent requests
        const customer = await stripe.customers.create(
          {
            email,
            metadata: {
              supabase_user_id: userId,
            },
          },
          {
            idempotencyKey: `create-customer-${userId}`,
          }
        );
        customerId = customer.id;
      }

      // Persist customer ID immediately so concurrent requests find it
      await supabaseAdmin
        .from('autopilot_subscriptions')
        .upsert({
          user_id: userId,
          stripe_customer_id: customerId,
          status: 'trialing',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: AUTOPILOT_PRICE_ID,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/start?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/start?checkout=canceled`,
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
          service: 'autopilot',
          plan_code: ACTIVE_AUTOPILOT_PLAN.code,
          price_lock: String(ACTIVE_AUTOPILOT_PLAN.priceLock),
        },
      },
      metadata: {
        supabase_user_id: userId,
        service: 'autopilot',
        plan_code: ACTIVE_AUTOPILOT_PLAN.code,
        license_plate_number: cleanPlate,
        license_plate_state: cleanState,
      },
    });

    // Update or create subscription record with customer ID
    // Note: status must be 'active', 'canceled', 'past_due', or 'trialing' per CHECK constraint
    await supabaseAdmin
      .from('autopilot_subscriptions')
      .upsert({
        user_id: userId,
        plan_code: ACTIVE_AUTOPILOT_PLAN.code,
        plan: 'autopilot',
        price_cents: ACTIVE_AUTOPILOT_PLAN.priceCents,
        price_lock: ACTIVE_AUTOPILOT_PLAN.priceLock,
        price_lock_cents: ACTIVE_AUTOPILOT_PLAN.priceLockCents,
        price_lock_expires_at: null,
        grace_period_days: ACTIVE_AUTOPILOT_PLAN.gracePeriodDays,
        stripe_customer_id: customerId,
        status: 'trialing', // Will be updated to 'active' by webhook after payment
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // Also create default settings if not exists
    await supabaseAdmin
      .from('autopilot_settings')
      .upsert({
        user_id: userId,
        auto_mail_enabled: true,
        require_approval: false,
        allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone', 'no_standing_time_restricted', 'parking_prohibited', 'residential_permit', 'missing_plate', 'commercial_loading'],
        never_auto_mail_unknown: true,
        email_on_ticket_found: true,
        email_on_letter_mailed: true,
        email_on_approval_needed: true,
      }, { onConflict: 'user_id' });

    return res.status(200).json({ url: session.url });
  } catch (error: any) {
    console.error('Checkout error:', error);
    return res.status(500).json({ error: sanitizeErrorMessage(error) });
  }
}
