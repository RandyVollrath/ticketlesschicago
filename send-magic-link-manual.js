const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendMagicLink(email) {
  console.log(`\n📧 Sending magic link to: ${email}\n`);

  // Generate magic link
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
  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Ticketless America <noreply@ticketlessamerica.com>',
      to: email,
      subject: 'Welcome to Ticketless Protection - Access Your Account',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Ticketless Protection!</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your Protection plan is now active! Click the button below to access your account:
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

          <p style="color: #666; font-size: 14px;">This link will expire in 60 minutes for security reasons.</p>

          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

          <p style="color: #9ca3af; font-size: 13px;">
            Questions? Email us at <a href="mailto:support@ticketlessamerica.com" style="color: #0052cc;">support@ticketlessamerica.com</a>
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
  console.log(`\n📬 Magic link sent to ${email}`);
}

const email = process.argv[2];
if (!email) {
  console.log('Usage: node send-magic-link-manual.js EMAIL');
  process.exit(1);
}

sendMagicLink(email);
