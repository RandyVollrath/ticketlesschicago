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

async function fix() {
  const email = 'mystreetcleaning+2@gmail.com';
  const userId = '6acba321-bd5c-405b-ab46-e3f43befd561';

  console.log('Fixing:', email);

  // Get Stripe session
  const sessions = await stripe.checkout.sessions.list({ limit: 30 });
  const session = sessions.data.find(s => s.customer_details?.email === email);

  const metadata = session.metadata;
  const stripeCustomerId = session.customer;
  const firstName = session.customer_details?.name?.split(' ')[0];
  const lastName = session.customer_details?.name?.split(' ').slice(1).join(' ');
  const zipCode = session.customer_details?.address?.postal_code;

  // Update profile
  const { error: updateError } = await supabase
    .from('user_profiles')
    .update({
      has_protection: true,
      stripe_customer_id: stripeCustomerId,
      is_paid: true,
      first_name: firstName,
      last_name: lastName,
      phone_number: metadata.phone,
      zip_code: zipCode,
      street_address: metadata.streetAddress,
      mailing_address: metadata.streetAddress,
      home_address_full: metadata.streetAddress,
      has_permit_zone: true,
      permit_requested: true,
      vehicle_type: 'P',
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (updateError) {
    console.error('Update error:', updateError.message);
    return;
  }

  console.log('✅ Profile updated');

  // Generate magic link
  const { data: linkData } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: process.env.NEXT_PUBLIC_SITE_URL + '/auth/callback?protection=true'
    }
  });

  // Send email
  await resend.emails.send({
    from: 'Autopilot America <noreply@autopilotamerica.com>',
    to: email,
    subject: 'Welcome to Ticket Protection - Access Your Account',
    html: '<div style="font-family: sans-serif; max-width: 600px;"><h2>Welcome to Ticket Protection!</h2><p>Click below to access your account:</p><div style="margin: 32px 0; text-align: center;"><a href="' + linkData.properties.action_link + '" style="background-color: #0052cc; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; display: inline-block;">Access My Account</a></div><p><strong>Important:</strong> Complete your profile to activate your $200/year ticket guarantee.</p></div>'
  });

  console.log('✅ EMAIL SENT!');
}

fix().catch(console.error);
