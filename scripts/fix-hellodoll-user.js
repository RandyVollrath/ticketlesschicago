#!/usr/bin/env node

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { Resend } = require('resend');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

async function fixUser() {
  const email = 'hellosexdollnow@gmail.com';
  const userId = 'ebccd03c-2cc9-47d0-9f5c-60abd40fbd70';

  console.log('🔧 Fixing user account:', email);
  console.log('');

  // Get Stripe session
  const sessions = await stripe.checkout.sessions.list({ limit: 20 });
  const session = sessions.data.find(s => s.customer_details?.email === email);

  if (!session) {
    console.log('❌ Stripe session not found');
    return;
  }

  const metadata = session.metadata;
  const stripeCustomerId = session.customer;
  const customerName = session.customer_details?.name;
  const firstName = customerName?.split(' ')[0] || null;
  const lastName = customerName?.split(' ').slice(1).join(' ') || null;
  const zipCode = session.customer_details?.address?.postal_code || null;

  console.log('Stripe data:');
  console.log('  Customer ID:', stripeCustomerId);
  console.log('  Name:', customerName);
  console.log('  Address:', metadata.streetAddress);
  console.log('  Phone:', metadata.phone);
  console.log('');

  // Create users table record
  const { error: usersError } = await supabase
    .from('users')
    .upsert({
      id: userId,
      email: email,
      phone: metadata.phone,
      first_name: firstName,
      last_name: lastName,
      zip_code: zipCode,
      mailing_address: metadata.streetAddress,
      mailing_zip: zipCode,
      home_address_full: metadata.streetAddress,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'id'
    });

  if (usersError && !usersError.message.includes('duplicate')) {
    console.error('⚠️ Users table:', usersError.message);
  } else {
    console.log('✅ Users table updated');
  }

  // Create profile
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      user_id: userId,
      email: email,
      first_name: firstName,
      last_name: lastName,
      phone_number: metadata.phone,
      zip_code: zipCode,
      vehicle_type: metadata.vehicleType || 'P',
      has_protection: true,
      stripe_customer_id: stripeCustomerId,
      city_sticker_expiry: metadata.citySticker || null,
      license_plate_expiry: metadata.licensePlate || null,
      mailing_address: metadata.streetAddress,
      mailing_zip: zipCode,
      street_address: metadata.streetAddress,
      home_address_full: metadata.streetAddress,
      has_permit_zone: metadata.hasPermitZone === 'true',
      permit_requested: metadata.permitRequested === 'true',
      is_paid: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

  if (profileError) {
    console.error('❌ Profile error:', profileError.message);
    return;
  }

  console.log('✅ Profile created successfully!');

  // Create consent
  const consentText = 'I authorize Autopilot America to act as my concierge service to monitor my vehicle renewal deadlines and coordinate renewals on my behalf. Autopilot America is not a government agency or licensed remitter. I authorize Autopilot America to charge my payment method for the subscription service fee plus government renewal fees (city sticker, license plate, parking permits) 30 days before my deadlines. Autopilot America will forward the government fees to our licensed remitter partner who will execute the official submission with the City of Chicago and State of Illinois. I understand that final acceptance is subject to approval by the issuing authority. I agree to provide accurate information and required documentation when requested.';

  const { error: consentError } = await supabase
    .from('user_consents')
    .insert({
      user_id: userId,
      consent_type: 'protection_purchase',
      consent_text: consentText,
      consent_granted: true,
      stripe_session_id: session.id,
      ip_address: 'US',
      metadata: {
        plan: metadata.plan,
        manually_created: true,
        reason: 'Webhook failed due to permit_zones bug (before fix deployed)'
      }
    });

  if (consentError) {
    console.log('⚠️ Consent:', consentError.message);
  } else {
    console.log('✅ Consent record created');
  }

  // Generate and send magic link
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?protection=true`
    }
  });

  if (linkError) {
    console.error('❌ Magic link error:', linkError.message);
    return;
  }

  console.log('✅ Magic link generated');
  console.log('');

  // Send email
  const { error: emailError } = await resend.emails.send({
    from: 'Autopilot America <noreply@autopilotamerica.com>',
    to: email,
    subject: 'Welcome to Ticket Protection - Access Your Account',
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Ticket Protection!</h2>

        <p style="color: #374151; font-size: 16px; line-height: 1.6;">
          Thanks for purchasing Ticket Protection! Click the button below to access your account:
        </p>

        <div style="margin: 32px 0; text-align: center;">
          <a href="${linkData.properties.action_link}"
             style="background-color: #0052cc;
                    color: white;
                    padding: 14px 32px;
                    text-decoration: none;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 16px;
                    display: inline-block;">
            Access My Account
          </a>
        </div>

        <p style="color: #666; font-size: 14px; margin-top: 32px;">
          <strong>Important:</strong> Your $200/year ticket guarantee requires a complete profile. Please add your renewal dates and upload your driver's license.
        </p>

        <p style="color: #666; font-size: 14px;">This link expires in 60 minutes.</p>

        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

        <p style="color: #9ca3af; font-size: 13px;">
          Questions? Reply to this email.
        </p>
      </div>
    `
  });

  if (emailError) {
    console.error('❌ Email error:', emailError.message);
  } else {
    console.log('✅ Welcome email sent!');
  }

  console.log('');
  console.log('🎉 User account fully fixed and email sent!');
}

fixUser().catch(console.error);
