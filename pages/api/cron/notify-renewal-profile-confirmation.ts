import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron Job: Remind PAID Protection users to confirm their profile before renewal
 *
 * Sends reminders at days specified in user's notification_preferences.reminder_days
 * Default: [60, 45, 37, 30] days before their earliest upcoming renewal date
 *
 * Only sends to users who have:
 * - has_protection = true (paid users)
 * - At least one renewal date set (city_sticker_expiry, license_plate_expiry, or emissions_test_due)
 *
 * Schedule: Daily at 9 AM CT
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

    console.log('📋 Checking for paid Protection users needing profile confirmation reminders...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Look ahead 65 days to catch all possible reminder windows
    const maxLookAhead = new Date();
    maxLookAhead.setDate(today.getDate() + 65);

    // Get all paid Protection users with at least one renewal date set
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
        has_permit_zone,
        permit_requested,
        license_image_path,
        license_image_path_back,
        residency_proof_path,
        email_forwarding_configured,
        notification_preferences,
        profile_confirmed_at
      `)
      .eq('has_protection', true);

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} paid Protection users`);

    const notificationsSent: Record<number, number> = {};
    const errors: any[] = [];

    for (const user of users || []) {
      try {
        // Get user's reminder days preference
        const reminderDays: number[] =
          user.notification_preferences?.reminder_days || DEFAULT_REMINDER_DAYS;

        // Find earliest upcoming renewal date
        const renewalDates: { type: string; date: Date }[] = [];

        if (user.city_sticker_expiry) {
          renewalDates.push({
            type: 'city_sticker',
            date: new Date(user.city_sticker_expiry)
          });
        }
        if (user.license_plate_expiry) {
          renewalDates.push({
            type: 'license_plate',
            date: new Date(user.license_plate_expiry)
          });
        }
        if (user.emissions_test_due) {
          renewalDates.push({
            type: 'emissions',
            date: new Date(user.emissions_test_due)
          });
        }

        // Skip if no renewal dates set
        if (renewalDates.length === 0) {
          continue;
        }

        // Find earliest renewal
        renewalDates.sort((a, b) => a.date.getTime() - b.date.getTime());
        const earliestRenewal = renewalDates[0];

        // Calculate days until renewal
        const daysUntilRenewal = Math.ceil(
          (earliestRenewal.date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        // Check if today matches any of their reminder days
        const matchingReminderDay = reminderDays.find(day =>
          daysUntilRenewal >= day && daysUntilRenewal <= day + 1
        );

        if (!matchingReminderDay) {
          continue;
        }

        // Check what needs attention in their profile
        const profileIssues = getProfileIssues(user);

        console.log(`User ${user.user_id}: ${daysUntilRenewal} days until ${earliestRenewal.type} renewal, sending ${matchingReminderDay}-day reminder`);

        const emailSent = await sendProfileConfirmationEmail(
          user,
          earliestRenewal,
          daysUntilRenewal,
          matchingReminderDay,
          profileIssues,
          renewalDates
        );

        if (emailSent) {
          notificationsSent[matchingReminderDay] = (notificationsSent[matchingReminderDay] || 0) + 1;
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
      message: `Sent ${totalNotified} profile confirmation reminders`,
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

interface ProfileIssues {
  missingDates: string[];
  missingPermitDocs: boolean;
  missingResidencyProof: boolean;
  allGood: boolean;
}

function getProfileIssues(user: any): ProfileIssues {
  const issues: ProfileIssues = {
    missingDates: [],
    missingPermitDocs: false,
    missingResidencyProof: false,
    allGood: true,
  };

  // Check for missing dates (informational - we still send reminder)
  if (!user.city_sticker_expiry) {
    issues.missingDates.push('city sticker expiration');
    issues.allGood = false;
  }
  if (!user.license_plate_expiry) {
    issues.missingDates.push('license plate expiration');
    issues.allGood = false;
  }
  if (!user.emissions_test_due) {
    issues.missingDates.push('emissions test due date');
    issues.allGood = false;
  }

  // Check permit-related documents (only if user has permit zone and requested permit)
  if (user.has_permit_zone && user.permit_requested) {
    if (!user.license_image_path || !user.license_image_path_back) {
      issues.missingPermitDocs = true;
      issues.allGood = false;
    }
    if (!user.email_forwarding_configured && !user.residency_proof_path) {
      issues.missingResidencyProof = true;
      issues.allGood = false;
    }
  }

  return issues;
}

async function sendProfileConfirmationEmail(
  user: any,
  earliestRenewal: { type: string; date: Date },
  daysUntilRenewal: number,
  reminderDay: number,
  issues: ProfileIssues,
  allRenewals: { type: string; date: Date }[]
): Promise<boolean> {
  try {
    const name = user.first_name || 'there';
    const renewalDate = earliestRenewal.date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const renewalTypeLabel = {
      city_sticker: 'city sticker',
      license_plate: 'license plate',
      emissions: 'emissions test',
    }[earliestRenewal.type] || 'renewal';

    // Build upcoming renewals list
    const upcomingList = allRenewals
      .map(r => {
        const label = {
          city_sticker: 'City Sticker',
          license_plate: 'License Plates',
          emissions: 'Emissions Test',
        }[r.type] || r.type;
        const dateStr = r.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return `  - ${label}: ${dateStr}`;
      })
      .join('\n');

    // Build action items if there are issues
    let actionItems = '';
    if (!issues.allGood) {
      const items: string[] = [];
      if (issues.missingDates.length > 0) {
        items.push(`Add missing dates: ${issues.missingDates.join(', ')}`);
      }
      if (issues.missingPermitDocs) {
        items.push('Upload driver\'s license (front and back) for permit renewal');
      }
      if (issues.missingResidencyProof) {
        items.push('Set up proof of residency (email forwarding recommended)');
      }
      actionItems = `
Action needed:
${items.map(item => `  - ${item}`).join('\n')}
`;
    }

    // Determine urgency based on days
    let urgencyPrefix = '';
    let subject = '';

    if (reminderDay >= 60) {
      subject = `Upcoming Renewal: Please Confirm Your Profile (${daysUntilRenewal} days)`;
    } else if (reminderDay >= 45) {
      subject = `Renewal Reminder: Confirm Your Profile is Up to Date`;
    } else if (reminderDay >= 37) {
      urgencyPrefix = '⏰ ';
      subject = `${urgencyPrefix}${daysUntilRenewal} Days Until Renewal - Please Confirm Profile`;
    } else {
      urgencyPrefix = '🚨 ';
      subject = `${urgencyPrefix}${daysUntilRenewal} Days Until Renewal - Action Required`;
    }

    const body = `
Hi ${name},

Your ${renewalTypeLabel} renewal is coming up on ${renewalDate} (${daysUntilRenewal} days away).

Please take a moment to confirm your profile information is current so we can process your renewal smoothly.

📅 Your Upcoming Renewals:
${upcomingList}
${actionItems}
${issues.allGood ? `
✅ Your profile looks complete! Just confirm everything is still accurate.
` : ''}
⚡ Review Your Profile:
→ https://autopilotamerica.com/settings

What we check:
✓ Renewal dates are accurate
✓ Vehicle information is current
✓ Contact information is up to date
${user.has_permit_zone && user.permit_requested ? '✓ Permit documents are ready (license + residency proof)' : ''}

We'll handle everything else automatically. If you've recently updated your profile, you're all set!

Questions? Reply to this email.

Thanks for being a Protection member!

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

    console.log(`✓ ${reminderDay}-day reminder sent to ${user.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}
