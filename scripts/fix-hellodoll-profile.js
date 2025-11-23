#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function fixUser() {
  const email = 'hellodolldarlings@gmail.com';

  console.log('🔍 Fixing user:', email);

  // Get auth user
  const { data: { users } } = await supabase.auth.admin.listUsers();
  const authUser = users.find(u => u.email === email);

  if (!authUser) {
    console.error('❌ Auth user not found');
    return;
  }

  console.log('✅ Found auth user:', authUser.id);

  // Check if profile exists
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('user_id')
    .eq('user_id', authUser.id)
    .single();

  if (profile) {
    console.log('✅ Profile already exists');
    return;
  }

  console.log('⚠️ No profile found - creating...');

  // Create profile with Protection enabled
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      user_id: authUser.id,
      email: email,
      first_name: 'Doll',
      last_name: 'Darlings',
      has_protection: true,
      notify_email: true,
      notify_sms: false,
      is_paid: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

  if (profileError) {
    console.error('❌ Profile creation error:', profileError);
    return;
  }

  console.log('✅ Profile created');

  // Generate and send magic link
  console.log('📧 Generating magic link...');
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?protection=true`
    }
  });

  if (linkError) {
    console.error('❌ Link generation error:', linkError);
    return;
  }

  const magicLink = linkData?.properties?.action_link;
  console.log('✅ Magic link generated');

  // Send email via Resend
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Autopilot America <noreply@autopilotamerica.com>',
      to: email,
      subject: 'Complete Your Profile - Autopilot America',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Ticket Protection!</h2>
          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Thank you for signing up for Ticket Protection! Click the button below to access your account and complete your profile.
          </p>
          <div style="margin: 32px 0; text-align: center;">
            <a href="${magicLink}"
               style="background-color: #0052cc;
                      color: white;
                      padding: 14px 32px;
                      text-decoration: none;
                      border-radius: 8px;
                      font-weight: 600;
                      font-size: 16px;
                      display: inline-block;">
              Complete My Profile
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes.</p>
        </div>
      `
    })
  });

  if (resendResponse.ok) {
    const result = await resendResponse.json();
    console.log(`✅ Magic link email sent successfully (Email ID: ${result.id})`);
  } else {
    const errorText = await resendResponse.text();
    console.error(`❌ Failed to send email: ${errorText}`);
  }
}

fixUser().catch(console.error);
