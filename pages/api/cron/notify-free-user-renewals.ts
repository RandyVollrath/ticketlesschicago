import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron Job: Send simple renewal reminders to FREE users
 *
 * Sends reminders at days specified in user's notification_preferences.reminder_days
 * Default: [60, 45, 37, 30] days before their earliest upcoming renewal date
 *
 * Only sends to users who have:
 * - has_protection = false (free users)
 * - At least one renewal date set (city_sticker_expiry, license_plate_expiry, or emissions_test_due)
 *
 * Different from paid user notifications:
 * - Simple "heads up" reminder about upcoming expiration
 * - No profile confirmation needed
 * - Includes soft upsell to Protection
 *
 * Schedule: Daily at 10 AM CT
 */

const DEFAULT_REMINDER_DAYS = [60, 45, 37, 30];

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

    console.log('📋 Checking for free users needing renewal reminders...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get all free users with at least one renewal date set
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        city_sticker_expiry,
        license_plate_expiry,
        emissions_test_due,
        notification_preferences
      `)
      .eq('has_protection', false);

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} free users`);

    const notificationsSent: Record<number, number> = {};
    const errors: any[] = [];

    for (const user of users || []) {
      try {
        // Get user's reminder days preference
        const reminderDays: number[] =
          user.notification_preferences?.reminder_days || DEFAULT_REMINDER_DAYS;

        // Find all upcoming renewal dates
        const renewalDates: { type: string; date: Date; label: string }[] = [];

        if (user.city_sticker_expiry) {
          renewalDates.push({
            type: 'city_sticker',
            date: new Date(user.city_sticker_expiry),
            label: 'City Sticker'
          });
        }
        if (user.license_plate_expiry) {
          renewalDates.push({
            type: 'license_plate',
            date: new Date(user.license_plate_expiry),
            label: 'License Plates'
          });
        }
        if (user.emissions_test_due) {
          renewalDates.push({
            type: 'emissions',
            date: new Date(user.emissions_test_due),
            label: 'Emissions Test'
          });
        }

        // Skip if no renewal dates set
        if (renewalDates.length === 0) {
          continue;
        }

        // Check each renewal date against reminder days
        for (const renewal of renewalDates) {
          const daysUntilRenewal = Math.ceil(
            (renewal.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
          );

          // Skip if already passed
          if (daysUntilRenewal < 0) {
            continue;
          }

          // Check if today matches any of their reminder days (exact match)
          const matchingReminderDay = reminderDays.find(day => daysUntilRenewal === day);

          if (!matchingReminderDay) {
            continue;
          }

          console.log(`User ${user.user_id}: ${daysUntilRenewal} days until ${renewal.type}, sending ${matchingReminderDay}-day reminder`);

          const emailSent = await sendFreeUserRenewalEmail(
            user,
            renewal,
            daysUntilRenewal,
            matchingReminderDay
          );

          if (emailSent) {
            notificationsSent[matchingReminderDay] = (notificationsSent[matchingReminderDay] || 0) + 1;
          }
        }
      } catch (error: any) {
        console.error(`Error processing user ${user.user_id}:`, error);
        errors.push({
          userId: user.user_id,
          error: sanitizeErrorMessage(error),
        });
      }
    }

    const totalNotified = Object.values(notificationsSent).reduce((a, b) => a + b, 0);

    return res.status(200).json({
      success: true,
      message: `Sent ${totalNotified} free user renewal reminders`,
      breakdown: notificationsSent,
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

async function sendFreeUserRenewalEmail(
  user: any,
  renewal: { type: string; date: Date; label: string },
  daysUntilRenewal: number,
  reminderDay: number
): Promise<boolean> {
  try {
    const name = user.first_name || 'there';
    const renewalDate = renewal.date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    // Different messaging based on renewal type
    let ticketWarning = '';
    let actionSteps = '';

    if (renewal.type === 'city_sticker') {
      ticketWarning = 'Expired city stickers result in $200 tickets.';
      actionSteps = `
How to renew:
1. Visit chicityclerk.com or any Chicago City Clerk location
2. Bring your vehicle registration
3. Pay the renewal fee (~$100 for most vehicles)
4. Display new sticker before ${renewalDate}
      `.trim();
    } else if (renewal.type === 'license_plate') {
      ticketWarning = 'Expired plates result in $120+ tickets and potential towing.';
      actionSteps = `
How to renew:
1. Visit ilsos.gov or any Secretary of State facility
2. Complete emissions test if required
3. Pay renewal fee ($151 for most vehicles)
4. New sticker must be displayed before ${renewalDate}
      `.trim();
    } else if (renewal.type === 'emissions') {
      ticketWarning = 'You cannot renew your plates without a valid emissions test.';
      actionSteps = `
How to complete:
1. Visit any Illinois emissions testing station
2. Bring your vehicle registration
3. Test takes about 10 minutes
4. Results are sent electronically to the state
      `.trim();
    }

    // Determine urgency
    let urgencyPrefix = '';
    let subject = '';

    if (reminderDay >= 45) {
      subject = `Reminder: Your ${renewal.label} expires ${renewalDate}`;
    } else if (reminderDay >= 30) {
      urgencyPrefix = '⏰ ';
      subject = `${urgencyPrefix}${daysUntilRenewal} Days: ${renewal.label} Renewal Coming Up`;
    } else if (reminderDay >= 14) {
      urgencyPrefix = '⚠️ ';
      subject = `${urgencyPrefix}${daysUntilRenewal} Days Left: Renew Your ${renewal.label}`;
    } else {
      urgencyPrefix = '🚨 ';
      subject = `${urgencyPrefix}URGENT: ${renewal.label} Expires in ${daysUntilRenewal} Days`;
    }

    const body = `
Hi ${name},

Just a friendly reminder: Your ${renewal.label.toLowerCase()} expires on ${renewalDate} (${daysUntilRenewal} days from now).

${ticketWarning}

${actionSteps}

---

💡 Tired of remembering renewal dates?

Autopilot America Protection ($8/month) handles everything for you:
✓ Automatic city sticker renewals
✓ License plate renewal reminders
✓ Emissions test tracking
✓ $200/year ticket guarantee
✓ Parking permit management

→ Learn more: https://autopilotamerica.com/protection

---

You're receiving this because you signed up for renewal reminders on Autopilot America.

Manage your reminder preferences: https://autopilotamerica.com/settings

—
Autopilot America
    `.trim();

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

    console.log(`✓ ${reminderDay}-day ${renewal.type} reminder sent to ${user.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}
