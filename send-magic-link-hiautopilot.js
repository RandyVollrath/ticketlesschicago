const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function sendMagicLink() {
  const email = 'hiautopilotamerica+1@gmail.com';
  
  try {
    console.log('🔐 Generating magic link for:', email);
    
    const { data, error } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?redirect=/settings&welcome=true`
      }
    });

    if (error) {
      console.error('❌ Error generating link:', error);
      return;
    }

    const magicLink = data?.properties?.action_link;
    console.log('\n✅ Magic link generated successfully!');
    console.log('\n📧 Sending email via Resend...');

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
        subject: 'Your Login Link - Autopilot America',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a1a; margin-bottom: 16px;">Your Login Link</h2>

            <p style="color: #374151; font-size: 16px; line-height: 1.6;">
              Click the button below to log in to your Autopilot America account:
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
                Log In to Autopilot America
              </a>
            </div>

            <p style="color: #666; font-size: 14px; margin-top: 24px;">
              This link will expire in 60 minutes.
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

    if (resendResponse.ok) {
      const result = await resendResponse.json();
      console.log(`✅ Email sent successfully! Email ID: ${result.id}`);
    } else {
      const errorText = await resendResponse.text();
      console.error('❌ Resend error:', errorText);
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

sendMagicLink();
