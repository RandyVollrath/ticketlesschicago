import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { notificationLogger } from '../../../lib/notification-logger';

/**
 * Cron Job: Send renewal reminders to inactive users
 *
 * Sends reminders at days specified in user's notification_preferences.reminder_days
 * Default: [60, 45, 37, 30] days before their earliest upcoming renewal date
 *
 * Only sends to users who have:
 * - has_contesting = false (account not yet activated)
 * - At least one renewal date set (city_sticker_expiry, license_plate_expiry, or emissions_date)
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

    console.log('📋 Checking for users needing renewal reminders...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get inactive users with at least one renewal date set.
    // NOTE: This targets has_contesting=false (legacy "free" users). As of Mar 2026
    // all new users are paid, so this set is shrinking. Kept for legacy accounts.
    // Pagination prevents unbounded memory usage as user_profiles grows.
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select(`
        user_id,
        email,
        first_name,
        last_name,
        phone,
        phone_number,
        notify_sms,
        notify_email,
        city_sticker_expiry,
        license_plate_expiry,
        emissions_date,
        emissions_completed,
        notification_preferences
      `)
      .eq('has_contesting', false)
      .limit(1000);

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} users needing reminders`);

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
        if (user.emissions_date) {
          renewalDates.push({
            type: 'emissions',
            date: new Date(user.emissions_date),
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

          const emailSent = user.notify_email !== false
            ? await sendRenewalReminderEmail(
                user,
                renewal,
                daysUntilRenewal,
                matchingReminderDay
              )
            : false;

          // SMS backup so a spam-foldered renewal email doesn't blow a
          // $200 plate violation or $90 sticker violation. Gated on
          // notify_sms + phone on file.
          const phone = user.phone_number || user.phone;
          const smsSent = (user.notify_sms && phone)
            ? await sendRenewalReminderSMS(
                user,
                phone,
                renewal,
                daysUntilRenewal,
                matchingReminderDay,
              )
            : false;

          if (emailSent || smsSent) {
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
      message: `Sent ${totalNotified} renewal reminders`,
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

async function sendRenewalReminderEmail(
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

      // Check if emissions is blocking their renewal
      const emissionsBlocking = !user.emissions_completed;

      if (emissionsBlocking) {
        actionSteps = `
⚠️ IMPORTANT: You must complete your emissions test FIRST!

Step 1 - Emissions Test (REQUIRED):
1. Visit any Illinois emissions testing station (airteam.app)
2. Bring your vehicle registration
3. Test takes about 10 minutes
4. Results are sent electronically to the state

Step 2 - Then Renew Plates:
1. Visit ilsos.gov or any Secretary of State facility
2. Pay renewal fee ($151 for most vehicles)
3. New sticker must be displayed before ${renewalDate}
        `.trim();
      } else {
        actionSteps = `
How to renew:
1. Visit ilsos.gov or any Secretary of State facility
2. Pay renewal fee ($151 for most vehicles)
3. New sticker must be displayed before ${renewalDate}
        `.trim();
      }
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

async function sendRenewalReminderSMS(
  user: any,
  phone: string,
  renewal: { type: string; label: string; date: Date },
  daysUntilRenewal: number,
  reminderDay: number,
): Promise<boolean> {
  try {
    const fineMap: Record<string, string> = {
      city_sticker: '$90',
      license_plate: '$200',
      emissions: '$25 late fee + registration block',
    };
    const fineText = fineMap[renewal.type] || 'a fine';
    const renewalDate = renewal.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const message =
      `Autopilot America: your ${renewal.label.toLowerCase()} expires ${renewalDate} (in ${daysUntilRenewal} day${daysUntilRenewal === 1 ? '' : 's'}). ` +
      `Miss it and you risk ${fineText}. Renew at autopilotamerica.com/settings. ` +
      `Reply STOP to unsubscribe.`;

    const logId = await notificationLogger.log({
      user_id: user.user_id,
      phone,
      notification_type: 'sms',
      category: `renewal_reminder_${renewal.type}`,
      content_preview: message.slice(0, 200),
      status: 'pending',
    });

    const result = await sendClickSendSMS(phone, message);
    if (!result.success) {
      console.error(`SMS send failed for ${phone}:`, result.error);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, result.error);
      return false;
    }
    if (logId) await notificationLogger.updateStatus(logId, 'sent', result.messageId);
    console.log(`✓ ${reminderDay}-day ${renewal.type} SMS reminder sent to ${phone}`);
    return true;
  } catch (error: any) {
    console.error('SMS send error:', error);
    return false;
  }
}
