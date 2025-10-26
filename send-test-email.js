require('dotenv').config({ path: '.env.local' });

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const TEST_EMAIL = 'ticketlessamerica@gmail.com'; // Send test to yourself

async function sendTestEmail() {
  console.log('\n📧 Sending TEST email to:', TEST_EMAIL, '\n');

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f5f5f5;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); padding: 40px 32px;">

    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
      Hello from MyStreetCleaning,
    </p>

    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 10px 0;">
      I built MyStreetCleaning to help folks avoid street-cleaning tickets.
    </p>

    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
      It's now TicketlessAmerica — we offer <strong>free alerts</strong> for city-sticker, license-plate, emissions-testing, snow-ban, and street-cleaning deadlines.
    </p>

    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 10px 0; font-weight: 600;">
      Want extra peace of mind?
    </p>

    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 30px 0;">
      For $12/month our protection plan covers those same eligible tickets (up to $200) and we'll handle sticker renewals for you.
    </p>

    <p style="font-size: 16px; line-height: 1.6; margin: 0 0 20px 0;">
      Reply <strong>YES</strong> to this email and I'll send your activation link, or click here to activate free alerts now:
    </p>

    <!-- CTA Button -->
    <div style="text-align: center; margin: 30px 0;">
      <a href="https://ticketlessamerica.com/activate?utm_source=email&utm_medium=userblast&utm_campaign=msc_migration_oct2025" style="display: inline-block; background: #0052cc; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(0,82,204,0.3);">
        Activate Free Alerts Now →
      </a>
    </div>

    <p style="font-size: 16px; line-height: 1.6; margin: 30px 0 20px 0;">
      If you'd like details about the protection plan:
    </p>

    <div style="text-align: center; margin: 30px 0;">
      <a href="https://ticketlessamerica.com/upgrade?utm_source=email&utm_medium=userblast&utm_campaign=msc_migration_oct2025" style="display: inline-block; background: white; color: #0052cc; border: 2px solid #0052cc; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">
        Learn About Protection →
      </a>
    </div>

    <!-- Footer -->
    <div style="margin-top: 40px; padding-top: 30px; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0 0 5px 0; font-size: 16px; line-height: 1.6;">
        Thanks,
      </p>
      <p style="margin: 0 0 5px 0; font-size: 16px; font-weight: 600;">
        Randy Vollrath
      </p>
      <p style="margin: 0 0 5px 0; font-size: 16px;">
        TicketlessAmerica
      </p>
      <p style="margin: 0; font-size: 16px; color: #666;">
        224-321-7290 | <a href="https://ticketlessamerica.com" style="color: #0052cc; text-decoration: none;">ticketlessamerica.com</a>
      </p>
    </div>

  </div>
</body>
</html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Randy from MyStreetCleaning <noreply@ticketlessamerica.com>',
        reply_to: 'ticketlessamerica@gmail.com',
        to: TEST_EMAIL,
        subject: 'Free Chicago alerts + optional ticket protection',
        html: htmlContent
      })
    });

    if (response.ok) {
      const result = await response.json();
      console.log('✅ TEST EMAIL SENT!');
      console.log('Email ID:', result.id);
      console.log('\nCheck your inbox at:', TEST_EMAIL);
      console.log('\nTry replying to test the reply-to functionality!');
    } else {
      const errorData = await response.json();
      console.error('❌ Failed to send:', JSON.stringify(errorData, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

sendTestEmail();
