const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function testProtectionWebhook(email, metadata = {}) {
  console.log(`\n🧪 Simulating protection webhook for: ${email}\n`);

  // Check if user already exists
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(u => u.email === email);

  if (existingUser) {
    console.log('⚠️  User already exists:', existingUser.id);
    console.log('Run cleanup-test-user.js first if you want to test fresh signup\n');
    return;
  }

  // Create new user (simulating webhook)
  console.log('Creating new user account...');
  const { data: newAuthData, error: authError } = await supabase.auth.admin.createUser({
    email: email,
    email_confirm: true
  });

  if (authError) {
    console.error('❌ Error creating user:', authError);
    return;
  }

  const userId = newAuthData.user.id;
  console.log('✅ Created user:', userId);

  // Create user profile
  console.log('Creating user profile...');
  const { error: profileError } = await supabase
    .from('user_profiles')
    .insert({
      user_id: userId,
      email: email,
      phone_number: metadata.phone || null,
      has_protection: true,
      mailing_address: metadata.address || null,
      street_address: metadata.address || null,
      home_address_full: metadata.address || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

  if (profileError) {
    console.error('❌ Error creating profile:', profileError);
    return;
  }

  console.log('✅ Created profile with has_protection=true');

  // Generate magic link
  console.log('\n📧 Generating magic link...');
  const { data: linkData, error: magicLinkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`
    }
  });

  if (magicLinkError) {
    console.error('❌ Error generating magic link:', magicLinkError);
    return;
  }

  if (!linkData?.properties?.action_link) {
    console.error('❌ No action link generated');
    return;
  }

  console.log('✅ Magic link generated');

  // Send via Resend
  console.log('📤 Sending email via Resend...');
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Ticketless America <noreply@ticketlessamerica.com>',
      to: email,
      subject: 'Welcome to Ticketless America - Complete Your Profile',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Ticketless America!</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Thanks for purchasing Ticket Protection! Click the button below to securely log in to your account and complete your profile:
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
              Complete My Profile
            </a>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 32px;">
            <strong>Important:</strong> Your $200/year ticket guarantee requires a complete and accurate profile. Please verify all your information within 24 hours.
          </p>

          <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes for security reasons.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px;">
            Questions? Email us at <a href="mailto:support@ticketlessamerica.com" style="color: #0052cc;">support@ticketlessamerica.com</a>
          </p>

          <p style="color: #9ca3af; font-size: 12px;">
            Ticketless America • Peace of mind parking
          </p>
        </div>
      `
    })
  });

  const resendData = await resendResponse.json();

  if (!resendResponse.ok) {
    console.error('❌ Resend error:', resendData);
    return;
  }

  console.log('✅ Email sent via Resend:', resendData.id);
  console.log(`\n🎉 Success! Check ${email} for the magic link.\n`);
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node test-protection-webhook.js EMAIL [phone] [address]');
  console.log('Example: node test-protection-webhook.js test@example.com "+15551234567" "123 Main St"');
  process.exit(1);
}

const metadata = {
  phone: process.argv[3] || null,
  address: process.argv[4] || null
};

testProtectionWebhook(email, metadata);
