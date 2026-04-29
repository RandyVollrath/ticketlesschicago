import type { NextApiRequest, NextApiResponse } from 'next';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { ACTIVE_AUTOPILOT_PLAN, ACTIVE_MONTHLY_PLAN, AUTOPILOT_PRICE_ID, AUTOPILOT_MONTHLY_PRICE_ID } from '../../../lib/autopilot-plans';
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

    const { licensePlate, plateState, billingPlan, contestConsent, consentSignature } = req.body;
    const isMonthly = billingPlan === 'monthly';

    if (!licensePlate) {
      return res.status(400).json({ error: 'License plate required' });
    }

    // AUTHORIZATION GATE (Chicago Municipal Code § 9-100-070 / Illinois UETA):
    // Require the user to authorize Autopilot to contest tickets on their behalf
    // before creating the Stripe subscription. Client-side checkbox isn't
    // enough — we enforce here so the DB state matches what the user agreed
    // to. Without this the mail cron stalls every letter at the consent gate
    // until the Day-19 safety net fires.
    if (contestConsent !== true) {
      return res.status(400).json({
        error: 'Authorization required. Please check the box agreeing to let us contest tickets on your behalf before continuing.',
      });
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

    // Derive a typed-name signature for the authorization record. Prefer an
    // explicit signature from the client; fall back to OAuth profile name or
    // email local-part so we always have something on file.
    const meta = (userData.user.user_metadata || {}) as Record<string, any>;
    const metaName = [meta.full_name, meta.name].find(v => typeof v === 'string' && v.trim().length > 0);
    const signatureName = (typeof consentSignature === 'string' && consentSignature.trim())
      ? consentSignature.trim()
      : (metaName ? String(metaName).trim() : email.split('@')[0]);

    // Capture requester IP for the audit record.
    const fwd = (req.headers['x-forwarded-for'] || '') as string;
    const consentIp = fwd.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';

    // Persist contest authorization to user_profiles. Upsert handles both the
    // "row doesn't exist yet" and "row exists but consent never captured" cases.
    // Only overwrite if not already set — re-running checkout shouldn't move
    // the original consent timestamp/IP.
    const { data: existingProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('contest_consent')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existingProfile?.contest_consent) {
      await supabaseAdmin
        .from('user_profiles')
        .upsert({
          user_id: userId,
          email,
          contest_consent: true,
          contest_consent_at: new Date().toISOString(),
          contest_consent_ip: consentIp,
          contest_consent_signature: signatureName,
        }, { onConflict: 'user_id' });
    }

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

    // Select plan and price based on billing interval
    const selectedPlan = isMonthly ? ACTIVE_MONTHLY_PLAN : ACTIVE_AUTOPILOT_PLAN;
    const priceId = isMonthly ? AUTOPILOT_MONTHLY_PRICE_ID : AUTOPILOT_PRICE_ID;

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      allow_promotion_codes: true,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/start?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://autopilotamerica.com'}/start?checkout=canceled`,
      subscription_data: {
        metadata: {
          supabase_user_id: userId,
          service: 'autopilot',
          plan_code: selectedPlan.code,
          price_lock: String(selectedPlan.priceLock),
        },
      },
      metadata: {
        supabase_user_id: userId,
        service: 'autopilot',
        plan_code: selectedPlan.code,
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
        plan_code: selectedPlan.code,
        plan: 'autopilot',
        price_cents: selectedPlan.priceCents,
        price_lock: selectedPlan.priceLock,
        price_lock_cents: selectedPlan.priceLockCents,
        price_lock_expires_at: null,
        grace_period_days: selectedPlan.gracePeriodDays,
        stripe_customer_id: customerId,
        status: 'trialing', // Will be updated to 'active' by webhook after payment
        letters_included_remaining: 999, // Unlimited — no per-subscription letter cap
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' });

    // Also create default settings if not exists
    await supabaseAdmin
      .from('autopilot_settings')
      .upsert({
        user_id: userId,
        auto_mail_enabled: true,
        require_approval: false,
        allowed_ticket_types: ['expired_plates', 'no_city_sticker', 'expired_meter', 'disabled_zone', 'no_standing_time_restricted', 'parking_prohibited', 'residential_permit', 'missing_plate', 'commercial_loading', 'red_light', 'speed_camera'],
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
