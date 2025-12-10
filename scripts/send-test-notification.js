/**
 * Quick test script to send test notifications
 * Usage: node scripts/send-test-notification.js
 */

require('dotenv').config({ path: '.env.local' });

const TEST_EMAIL = 'randyvollrath@gmail.com';
const TEST_PHONE = '+12243217290';
const TEST_PLATE = 'TEST123';

async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    console.log('❌ RESEND_API_KEY not configured');
    return false;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: [to],
        subject,
        html,
      }),
    });

    const result = await response.json();
    if (response.ok) {
      console.log('✅ Email sent successfully:', result.id);
      return true;
    } else {
      console.log('❌ Email failed:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Email error:', error);
    return false;
  }
}

async function sendSMS(to, message) {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;

  if (!username || !apiKey) {
    console.log('❌ ClickSend not configured');
    return false;
  }

  try {
    const response = await fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64'),
      },
      body: JSON.stringify({
        messages: [{ to: to.replace(/\D/g, ''), body: message, source: 'nodejs' }],
      }),
    });

    const result = await response.json();
    if (response.ok) {
      console.log('✅ SMS sent successfully');
      return true;
    } else {
      console.log('❌ SMS failed:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ SMS error:', error);
    return false;
  }
}

async function main() {
  console.log('🧪 Sending test notifications...\n');
  console.log(`📧 Email: ${TEST_EMAIL}`);
  console.log(`📱 Phone: ${TEST_PHONE}\n`);

  // Import templates dynamically (they're TypeScript)
  // For now, use inline test content that matches the refactored templates

  // Test 1: Emissions reminder email
  console.log('--- Test 1: Emissions Test Reminder Email ---');
  const emissionsSubject = '⚠️ Emissions Test Due in 7 Days - Action Required';
  const emissionsHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
      <div style="background: #2563eb; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Autopilot America</h1>
        <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">Your Vehicle Renewal Autopilot</p>
      </div>
      <div style="padding: 32px 24px; background: #ffffff;">
        <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
          <h2 style="margin: 0 0 12px; color: #92400e; font-size: 20px;">Emissions Test Due in 7 Days</h2>
          <div style="color: #92400e; font-size: 16px; line-height: 1.5;">Your emissions test deadline is approaching quickly. Schedule your test now to avoid delays with your license plate renewal.</div>
        </div>
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <div style="margin-bottom: 8px;"><strong>Vehicle:</strong> 2020 Honda Civic (${TEST_PLATE})</div>
          <div><strong>Emissions Test Deadline:</strong> ${new Date(Date.now() + 7*24*60*60*1000).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
        </div>
        <h3 style="color: #374151; margin-bottom: 12px;">How to Get Your Emissions Test:</h3>
        <ol style="color: #4b5563; line-height: 1.8; padding-left: 20px;">
          <li>Find a testing location at <a href="https://airteam.app/forms/locator.cfm" style="color: #2563eb;">airteam.app</a></li>
          <li>Bring your vehicle registration</li>
          <li>The test takes about 10-15 minutes</li>
        </ol>
        <div style="margin-top: 24px; text-align: center;">
          <a href="https://airteam.app/forms/locator.cfm" style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600; font-size: 16px;">Find Testing Locations</a>
        </div>
        <p style="color: #6b7280; font-size: 14px; margin-top: 24px; text-align: center;">Questions? Reply to this email or contact support@autopilotamerica.com</p>
      </div>
      <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
        <div style="margin-bottom: 12px;"><strong style="color: #374151;">Autopilot America</strong><br>Trusted by 10,000+ Chicago drivers</div>
        <p style="margin: 0;">Questions? Contact us at support@autopilotamerica.com</p>
      </div>
    </div>
  `;
  await sendEmail(TEST_EMAIL, emissionsSubject, emissionsHtml);

  // Test 2: Emissions SMS
  console.log('\n--- Test 2: Emissions Test Reminder SMS ---');
  const emissionsSms = `Autopilot: Your emissions test is due in 7 days. Complete it soon so we can process your license plate renewal. Find locations: airteam.app Reply STOP to opt out.`;
  await sendSMS(TEST_PHONE, emissionsSms);

  // Test 3: Sticker purchased email
  console.log('\n--- Test 3: Sticker Purchased Email ---');
  const stickerSubject = 'Great news! Your Chicago City Sticker has been purchased';
  const expectedDelivery = new Date(Date.now() + 14*24*60*60*1000);
  const stickerHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background: white;">
      <div style="background: #2563eb; color: white; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 24px; font-weight: 600;">Autopilot America</h1>
        <p style="margin: 8px 0 0; font-size: 16px; opacity: 0.9;">Your Vehicle Renewal Autopilot</p>
      </div>
      <div style="padding: 32px 24px; background: #ffffff;">
        <div style="background: #d1fae5; border-left: 4px solid #10b981; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
          <h2 style="margin: 0 0 12px; color: #065f46; font-size: 20px;">🎉 City Sticker Purchased!</h2>
          <div style="color: #065f46; font-size: 16px; line-height: 1.5;">Your Chicago City Sticker for <strong>${TEST_PLATE}</strong> has been successfully purchased!</div>
        </div>
        <div style="background: #f0f9ff; border: 1px solid #0ea5e9; border-radius: 8px; padding: 20px; margin: 24px 0;">
          <h3 style="color: #0c4a6e; margin: 0 0 16px; font-size: 18px;">What's Next?</h3>
          <ul style="color: #0369a1; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>Your sticker will be mailed to your address on file</li>
            <li>Expected delivery: ${expectedDelivery.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</li>
            <li>Apply it to your windshield as soon as you receive it</li>
          </ul>
        </div>
        <p style="text-align: center; color: #6b7280;">Questions? Reply to this email or contact support@autopilotamerica.com</p>
      </div>
      <div style="padding: 20px; background: #f3f4f6; text-align: center; color: #6b7280; font-size: 14px; border-radius: 0 0 8px 8px;">
        <div style="margin-bottom: 12px;"><strong style="color: #374151;">Autopilot America</strong><br>Trusted by 10,000+ Chicago drivers</div>
        <p style="margin: 0;">Questions? Contact us at support@autopilotamerica.com</p>
      </div>
    </div>
  `;
  await sendEmail(TEST_EMAIL, stickerSubject, stickerHtml);

  // Test 4: Sticker purchased SMS
  console.log('\n--- Test 4: Sticker Purchased SMS ---');
  const stickerSms = `Autopilot: Great news! Your Chicago City Sticker for ${TEST_PLATE} has been purchased! It will be mailed to you and should arrive in 10-14 days. Reply STOP to opt out.`;
  await sendSMS(TEST_PHONE, stickerSms);

  console.log('\n✅ All test notifications sent! Check your email and phone.');
}

main().catch(console.error);
