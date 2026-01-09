import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron Job: Remind users to complete their Protection profiles
 *
 * Sends reminders at 3, 7, and 14 days after Protection signup
 * if critical fields are missing (renewal dates, license upload, etc.)
 *
 * Schedule: Daily at 10 AM CT
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify this is a cron job
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!supabaseAdmin) {
      throw new Error('Database not available');
    }

    console.log('📝 Checking for users with incomplete profiles...');

    const today = new Date();
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(today.getDate() - 14);

    // Get Protection users created in the last 14 days
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        created_at,
        city_sticker_expiry,
        license_plate_expiry,
        license_image_path,
        license_image_path_back,
        has_permit_zone,
        permit_requested,
        residency_forwarding_enabled,
        residency_proof_path
      `)
      .eq('has_contesting', true)
      .gte('created_at', fourteenDaysAgo.toISOString());

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} Protection users from last 14 days`);

    let notified3Days = 0;
    let notified7Days = 0;
    let notified14Days = 0;
    const errors: any[] = [];

    for (const user of users || []) {
      try {
        const createdDate = new Date(user.created_at);
        const daysSinceSignup = Math.floor((today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

        // Check what's missing
        const missingFields = {
          citySticker: !user.city_sticker_expiry,
          licensePlate: !user.license_plate_expiry,
          driverLicense: user.has_permit_zone && user.permit_requested && (!user.license_image_path || !user.license_image_path_back),
          residencyProof: user.has_permit_zone && user.permit_requested && !user.residency_forwarding_enabled && !user.residency_proof_path,
        };

        const hasMissingFields = Object.values(missingFields).some(missing => missing);

        if (!hasMissingFields) {
          console.log(`User ${user.user_id}: Profile complete, skipping`);
          continue;
        }

        // Send reminders at specific intervals
        let shouldNotify = false;
        let reminderDay: 3 | 7 | 14 | null = null;

        if (daysSinceSignup >= 14 && daysSinceSignup <= 15) {
          shouldNotify = true;
          reminderDay = 14;
        } else if (daysSinceSignup >= 7 && daysSinceSignup <= 8) {
          shouldNotify = true;
          reminderDay = 7;
        } else if (daysSinceSignup >= 3 && daysSinceSignup <= 4) {
          shouldNotify = true;
          reminderDay = 3;
        }

        if (!shouldNotify || !reminderDay) {
          continue;
        }

        console.log(`Sending day-${reminderDay} reminder to user ${user.user_id} (${daysSinceSignup} days since signup)`);

        const emailSent = await sendProfileCompletionReminder(user, missingFields, reminderDay);

        if (emailSent) {
          if (reminderDay === 3) notified3Days++;
          else if (reminderDay === 7) notified7Days++;
          else notified14Days++;
        }
      } catch (error: any) {
        console.error(`Error processing user ${user.user_id}:`, error);
        errors.push({
          userId: user.user_id,
          error: sanitizeErrorMessage(error),
        });
      }
    }

    const totalNotified = notified3Days + notified7Days + notified14Days;

    return res.status(200).json({
      success: true,
      message: `Sent ${totalNotified} profile completion reminders`,
      breakdown: {
        day3: notified3Days,
        day7: notified7Days,
        day14: notified14Days,
      },
      totalChecked: users?.length || 0,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      error: 'Cron job failed',
    });
  }
}

async function sendProfileCompletionReminder(
  user: any,
  missingFields: any,
  reminderDay: 3 | 7 | 14
): Promise<boolean> {
  try {
    const name = user.first_name || 'there';

    // Build checklist of missing items
    const todoItems: string[] = [];

    if (missingFields.citySticker) {
      todoItems.push('📅 Add your city sticker expiration date');
    }
    if (missingFields.licensePlate) {
      todoItems.push('🚗 Add your license plate expiration date');
    }
    if (missingFields.driverLicense) {
      todoItems.push('📸 Upload your driver\'s license (front and back)');
    }
    if (missingFields.residencyProof) {
      todoItems.push('🏠 Set up proof of residency (email forwarding or manual upload)');
    }

    const todoList = todoItems.map(item => `  ${item}`).join('\n');

    let subject = '';
    let body = '';

    if (reminderDay === 3) {
      subject = '👋 Quick Reminder: Complete Your Protection Profile';
      body = `
Hi ${name},

Thanks for signing up for Ticket Protection! To start getting automated renewal reminders and full Protection coverage, please complete your profile.

📋 What You Still Need to Add:

${todoList}

⚡ Complete Your Profile (5 minutes):
→ https://autopilotamerica.com/settings

Why this matters:
✓ We can't send renewal reminders without expiration dates
✓ Your $200/year ticket guarantee requires a complete profile
✓ Permit renewals require driver's license and proof of residency

Questions? Just reply to this email.

Thanks!

—
Autopilot America
      `.trim();
    } else if (reminderDay === 7) {
      subject = '⏰ Your Protection Profile Needs Attention';
      body = `
Hi ${name},

You're almost done! Just a few more details and you'll have full Protection coverage.

📋 Still Missing:

${todoList}

⚡ Finish Setup (5 minutes):
→ https://autopilotamerica.com/settings

Without these details:
⚠️  We can't send you renewal reminders
⚠️  Your ticket guarantee isn't active
⚠️  We can't process permit renewals

Complete your profile now to activate full Protection:
https://autopilotamerica.com/settings

Questions? Reply to this email.

—
Autopilot America
      `.trim();
    } else {
      // Day 14 - final reminder
      subject = '🚨 Final Reminder: Complete Your Protection Profile';
      body = `
Hi ${name},

This is your final reminder to complete your Ticket Protection profile.

📋 You're Still Missing:

${todoList}

⚠️  WITHOUT THESE, YOUR PROTECTION ISN'T ACTIVE:

• No renewal reminders will be sent
• Your $200/year ticket guarantee is not active
• We cannot process your renewals

⚡ Complete Now (Last Chance):
→ https://autopilotamerica.com/settings

This is the last reminder we'll send. Please take 5 minutes to finish your setup so you can enjoy worry-free parking.

Need help? Reply to this email or call us.

—
Autopilot America
      `.trim();
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { error } = await resend.emails.send({
      from: 'Autopilot America <hello@autopilotamerica.com>',
      to: user.email,
      subject: subject,
      text: body,
      headers: {
        'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });

    if (error) {
      console.error('Email send failed:', error);
      return false;
    }

    console.log(`✓ Day-${reminderDay} reminder sent to ${user.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}
