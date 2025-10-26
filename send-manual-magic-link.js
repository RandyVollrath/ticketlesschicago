const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

if (!supabaseUrl || !supabaseServiceKey || !resendApiKey) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function sendMagicLink() {
  const email = 'countluigivampa@gmail.com';

  console.log(`Sending magic link to: ${email}\n`);

  // Generate magic link
  const { data: linkData, error: magicLinkError } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: 'https://autopilotamerica.com/auth/callback'
    }
  });

  if (magicLinkError) {
    console.error('❌ Error generating magic link:', magicLinkError);
    return;
  }

  if (!linkData?.properties?.action_link) {
    console.error('❌ No action link in response');
    return;
  }

  console.log('✅ Magic link generated');
  console.log('Link:', linkData.properties.action_link);

  // Send via Resend
  console.log('\n📧 Sending email via Resend...');

  const fetch = (await import('node-fetch')).default;

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Autopilot America <noreply@autopilotamerica.com>',
      to: email,
      subject: 'Welcome to Autopilot America - Access Your Account',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Welcome to Autopilot America!</h2>

          <p style="color: #374151; font-size: 16px; line-height: 1.6;">
            Your free alerts are now active! Click the button below to access your account:
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
        </div>
      `
    })
  });

  if (resendResponse.ok) {
    const result = await resendResponse.json();
    console.log('✅ Email sent successfully!');
    console.log('Email ID:', result.id);
    console.log('\n📬 Check email:', email);
  } else {
    const errorText = await resendResponse.text();
    console.error('❌ Error sending email:', errorText);
  }
}

sendMagicLink().catch(console.error);
