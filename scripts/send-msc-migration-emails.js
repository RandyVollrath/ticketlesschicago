/**
 * Send migration welcome emails to MyStreetCleaning users
 *
 * This script sends an email to all users migrated from MyStreetCleaning
 * explaining the transition and providing a password reset link.
 *
 * Usage:
 *   DRY_RUN=true node scripts/send-msc-migration-emails.js   # Preview only
 *   node scripts/send-msc-migration-emails.js                 # Send emails
 */

const { createClient } = require("@supabase/supabase-js");
const { Resend } = require("resend");

require('dotenv').config({ path: '.env.local' });
require('dotenv').config({ path: '.env.vercel-pulled', override: true });

const AA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const AA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Autopilot America <noreply@autopilotamerica.com>';

if (!AA_URL || !AA_KEY) {
  console.error("Error: Missing AA database credentials in .env.local");
  process.exit(1);
}

if (!RESEND_API_KEY) {
  console.error("Error: Missing RESEND_API_KEY in .env.local");
  process.exit(1);
}

const aa = createClient(AA_URL, AA_KEY);
const resend = new Resend(RESEND_API_KEY);

const DRY_RUN = process.argv.includes('--dry-run');

async function sendMigrationEmails() {
  console.log("=".repeat(60));
  console.log(DRY_RUN ? "DRY RUN - No emails will be sent" : "LIVE MODE - Sending emails");
  console.log("=".repeat(60));
  console.log();

  // Get all migrated MSC users
  const { data: users, error } = await aa
    .from('user_profiles')
    .select('user_id, email, home_address_full, home_address_ward, home_address_section')
    .eq('role', 'msc_migrated');

  if (error) {
    console.error("Error fetching users:", error.message);
    return;
  }

  console.log(`Found ${users.length} migrated MSC users\n`);

  let sent = 0;
  let errors = 0;

  for (const user of users) {
    console.log(`Sending to: ${user.email}`);

    if (!DRY_RUN) {
      try {
        // Generate password reset link
        const { data: resetData, error: resetError } = await aa.auth.admin.generateLink({
          type: 'recovery',
          email: user.email,
          options: {
            redirectTo: 'https://autopilotamerica.com/reset-password'
          }
        });

        if (resetError) {
          console.error(`  Error generating reset link: ${resetError.message}`);
          errors++;
          continue;
        }

        const resetLink = resetData.properties.action_link;

        // Send the email
        const { error: emailError } = await resend.emails.send({
          from: RESEND_FROM,
          to: user.email,
          subject: 'MyStreetCleaning is now Autopilot America - Action Required',
          html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #333;">
  <h2 style="color: #2563eb;">MyStreetCleaning Has a New Home</h2>

  <p>Hi there,</p>

  <p>We're writing to let you know that <strong>MyStreetCleaning</strong> has merged with <strong>Autopilot America</strong>.</p>

  <p><strong>What this means for you:</strong></p>
  <ul>
    <li>Your street cleaning notifications will continue as usual</li>
    <li>Your address and notification preferences have been preserved</li>
    <li>You now have access to additional features like vehicle renewal reminders</li>
  </ul>

  <p><strong>Your saved address:</strong><br>
  ${user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`}</p>

  <h3 style="color: #2563eb;">Set Up Your Account</h3>

  <p>To access your account on Autopilot America, please set a password by clicking the button below:</p>

  <p style="text-align: center; margin: 30px 0;">
    <a href="${resetLink}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">Set My Password</a>
  </p>

  <p style="font-size: 12px; color: #666;">This link expires in 24 hours. If it doesn't work, visit <a href="https://autopilotamerica.com">autopilotamerica.com</a> and click "Forgot Password".</p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p>Questions? Just reply to this email.</p>

  <p>Thanks,<br>
  The Autopilot America Team</p>

  <p style="font-size: 11px; color: #999; margin-top: 30px;">
    You're receiving this because you had an account on MyStreetCleaning.com.
    Your street cleaning notifications will continue automatically.
  </p>
</body>
</html>
          `,
          text: `
MyStreetCleaning Has a New Home

Hi there,

We're writing to let you know that MyStreetCleaning has merged with Autopilot America.

What this means for you:
- Your street cleaning notifications will continue as usual
- Your address and notification preferences have been preserved
- You now have access to additional features like vehicle renewal reminders

Your saved address: ${user.home_address_full || `Ward ${user.home_address_ward}, Section ${user.home_address_section}`}

SET UP YOUR ACCOUNT

To access your account on Autopilot America, please set a password:
${resetLink}

This link expires in 24 hours. If it doesn't work, visit autopilotamerica.com and click "Forgot Password".

Questions? Just reply to this email.

Thanks,
The Autopilot America Team

---
You're receiving this because you had an account on MyStreetCleaning.com.
Your street cleaning notifications will continue automatically.
          `
        });

        if (emailError) {
          console.error(`  Error sending email: ${emailError.message}`);
          errors++;
          continue;
        }

        // Mark user as having received migration email
        await aa
          .from('user_profiles')
          .update({ role: 'msc_migrated_notified' })
          .eq('user_id', user.user_id);

        sent++;
        console.log(`  Sent successfully`);

        // Delay to avoid rate limiting (Resend allows 2 requests/second)
        await new Promise(resolve => setTimeout(resolve, 600));

      } catch (err) {
        console.error(`  Unexpected error: ${err.message}`);
        errors++;
      }
    } else {
      sent++;
    }
  }

  console.log();
  console.log("=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total users: ${users.length}`);
  console.log(`Emails sent: ${sent}`);
  console.log(`Errors: ${errors}`);

  if (DRY_RUN) {
    console.log("\nThis was a DRY RUN. To send emails, run:");
    console.log("  node scripts/send-msc-migration-emails.js");
  }
}

sendMigrationEmails().catch(console.error);
