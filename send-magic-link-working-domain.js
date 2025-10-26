const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

async function sendMagicLink() {
  const email = 'countluigivampa@gmail.com';

  console.log('Generating magic link...');
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: email,
    options: {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/settings`
    }
  });

  if (linkError) {
    console.error('Error generating magic link:', linkError);
    return;
  }

  console.log('Sending via Resend with ticketlesschicago.com domain...');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Ticketless America <noreply@ticketlesschicago.com>',
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
            Ticketless America • Never get another parking ticket
          </p>
        </div>
      `
    })
  });

  if (response.ok) {
    const result = await response.json();
    console.log('✅ Email sent successfully!');
    console.log('Email ID:', result.id);
  } else {
    const error = await response.text();
    console.error('❌ Error sending email:', error);
  }
}

sendMagicLink().catch(console.error);
