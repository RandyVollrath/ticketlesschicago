const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const MSC_SUPABASE_URL = 'https://zqljxkqdgfibfzdjfjiq.supabase.co';
const MSC_SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpxbGp4a3FkZ2ZpYmZ6ZGpmamlxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0Mjk2NTAyNCwiZXhwIjoyMDU4NTQxMDI0fQ.5z8BVRn9Xku7ZwSSfZwQLYyfjzw-aqsYm1HmHlujJes';

const supabase = createClient(MSC_SUPABASE_URL, MSC_SUPABASE_SERVICE_ROLE_KEY);

// IMPORTANT: Update these before running!
const RESEND_API_KEY = process.env.RESEND_API_KEY; // Your Resend API key
const FROM_EMAIL = 'Randy from MyStreetCleaning <noreply@mystreetcleaning.com>'; // MyStreetCleaning domain
const REPLY_TO = 'ticketlessamerica@gmail.com';
const DRY_RUN = true; // Set to false to actually send emails

// Test accounts to skip
const testEmails = [
  'randyvollrath@gmail.com',
  'thechicagoapp@gmail.com',
  'countluigivampa@gmail.com',
  'mystreetcleaning@gmail.com',
  'carenvollrath@gmail.com',
  'ticketlesschicago@gmail.com'
];

async function sendEmails() {
  console.log('\n🚀 MyStreetCleaning → Ticketless America Migration Email\n');
  console.log(`Mode: ${DRY_RUN ? '🔒 DRY RUN (no emails sent)' : '✅ LIVE (emails will be sent!)'}\n`);

  try {
    // Get all users with emails
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('email')
      .not('email', 'is', null)
      .neq('email', '')
      .order('email');

    if (error) throw error;

    const realUsers = users.filter(user => {
      // Skip test accounts
      if (testEmails.includes(user.email)) return false;
      if (user.email.includes('+')) return false;

      return true;
    });

    console.log(`📊 Found ${realUsers.length} users to email (including those already texted)\n`);

    if (DRY_RUN) {
      console.log('First 5 recipients:');
      realUsers.slice(0, 5).forEach(u => console.log(`  - ${u.email}`));
      console.log('\n⚠️  Set DRY_RUN = false to actually send emails\n');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < realUsers.length; i++) {
      const user = realUsers[i];

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
            from: FROM_EMAIL,
            reply_to: REPLY_TO,
            to: user.email,
            subject: 'Free Chicago alerts + optional ticket protection',
            html: htmlContent
          })
        });

        if (response.ok) {
          successCount++;
          console.log(`✅ [${i + 1}/${realUsers.length}] Sent to ${user.email}`);
        } else {
          const errorData = await response.json();
          errorCount++;
          console.error(`❌ [${i + 1}/${realUsers.length}] Failed: ${user.email} - ${JSON.stringify(errorData)}`);
        }

        // Rate limit: 10 emails per second max (100ms between emails)
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (err) {
        errorCount++;
        console.error(`❌ [${i + 1}/${realUsers.length}] Error: ${user.email} - ${err.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Sent successfully: ${successCount}`);
    console.log(`❌ Failed: ${errorCount}`);
    console.log(`📧 Total: ${realUsers.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

sendEmails();
