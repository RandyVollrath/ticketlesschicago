import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron Job: Notify users to upload proof of residency for permit renewals
 *
 * Sends reminders at 45, 30, and 14 days before city sticker renewal
 * to users with permit zones who haven't set up email forwarding or uploaded proof
 *
 * Schedule: Daily at 9 AM CT
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

    console.log('📋 Checking for users needing residency proof reminders...');

    const today = new Date();
    const fourtyFiveDaysFromNow = new Date();
    fourtyFiveDaysFromNow.setDate(today.getDate() + 45);

    // Get Protection users with permit zones and upcoming renewals
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, city_sticker_expiry, residency_proof_path, residency_forwarding_enabled')
      .eq('has_contesting', true)
      .eq('has_permit_zone', true)
      .eq('permit_requested', true)
      .not('city_sticker_expiry', 'is', null)
      .lte('city_sticker_expiry', fourtyFiveDaysFromNow.toISOString().split('T')[0]);

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} permit users with upcoming renewals`);

    let notified45Days = 0;
    let notified30Days = 0;
    let notified14Days = 0;
    const errors: any[] = [];

    for (const user of users || []) {
      try {
        const renewalDate = new Date(user.city_sticker_expiry);
        const daysUntilRenewal = Math.ceil((renewalDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Skip if they already have email forwarding configured OR residency proof uploaded
        if (user.residency_forwarding_enabled || user.residency_proof_path) {
          console.log(`User ${user.user_id}: Already has proof or forwarding configured, skipping`);
          continue;
        }

        // Check if we need to send reminder at specific intervals
        let shouldNotify = false;
        let urgency: 'first' | 'second' | 'urgent' = 'first';

        if (daysUntilRenewal <= 15 && daysUntilRenewal >= 13) {
          // 14-day urgent reminder
          shouldNotify = true;
          urgency = 'urgent';
        } else if (daysUntilRenewal <= 31 && daysUntilRenewal >= 29) {
          // 30-day second reminder
          shouldNotify = true;
          urgency = 'second';
        } else if (daysUntilRenewal <= 46 && daysUntilRenewal >= 44) {
          // 45-day first reminder
          shouldNotify = true;
          urgency = 'first';
        }

        if (!shouldNotify) {
          continue;
        }

        console.log(`Sending ${urgency} reminder to user ${user.user_id} (${daysUntilRenewal} days until renewal)`);

        const emailSent = await sendResidencyProofReminder(user, daysUntilRenewal, urgency);

        if (emailSent) {
          if (urgency === 'urgent') notified14Days++;
          else if (urgency === 'second') notified30Days++;
          else notified45Days++;
        }
      } catch (error: any) {
        console.error(`Error processing user ${user.user_id}:`, error);
        errors.push({
          userId: user.user_id,
          error: sanitizeErrorMessage(error),
        });
      }
    }

    const totalNotified = notified45Days + notified30Days + notified14Days;

    return res.status(200).json({
      success: true,
      message: `Sent ${totalNotified} residency proof reminders`,
      breakdown: {
        firstReminder: notified45Days,
        secondReminder: notified30Days,
        urgentReminder: notified14Days,
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

async function sendResidencyProofReminder(
  user: any,
  daysUntilRenewal: number,
  urgency: 'first' | 'second' | 'urgent'
): Promise<boolean> {
  try {
    const name = user.first_name || 'there';
    const renewalDate = new Date(user.city_sticker_expiry).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    let subject = '';
    let body = '';

    if (urgency === 'urgent') {
      subject = '🚨 URGENT: Proof of Residency Needed in 2 Weeks';
      body = `
Hi ${name},

🚨 URGENT: Your city sticker renewal is in just ${daysUntilRenewal} days (${renewalDate}), and we still need your proof of residency.

WITHOUT THIS DOCUMENT, WE CANNOT RENEW YOUR PARKING PERMIT.

⚡ QUICK FIX - Choose One:

Option 1: Set Up Email Forwarding (Recommended - 2 minutes)
→ https://autopilotamerica.com/settings#residency-proof
→ Forward utility bills automatically to us
→ Never worry about this again

Option 2: Upload Manually (5 minutes)
→ https://autopilotamerica.com/settings#residency-proof
→ Upload current utility bill, bank statement, or lease
→ Must be dated within last 90 days

Why we need this:
✓ The city REQUIRES proof of residency for parking permits
✓ Your permit cannot be renewed without this document
✓ This is a one-time setup if you use email forwarding

Questions? Reply to this email or call us.

Don't lose your parking permit!

—
Autopilot America
      `.trim();
    } else if (urgency === 'second') {
      subject = '⏰ Reminder: Proof of Residency Needed (30 Days)';
      body = `
Hi ${name},

Just a reminder: Your city sticker renewal is coming up in ${daysUntilRenewal} days (${renewalDate}), and we need your proof of residency to renew your parking permit.

📋 Easy Setup Options:

Option 1: Auto-Forward Utility Bills (Recommended)
→ https://autopilotamerica.com/settings#residency-proof
→ Set it once, never upload again
→ Takes 2 minutes

Option 2: Upload Document Manually
→ https://autopilotamerica.com/settings#residency-proof
→ Utility bill, bank statement, or lease
→ Must be dated within last 90 days

Why we need this:
The city requires current proof of residency (address verification) to issue parking permits. Without it, we can't renew your permit.

Questions? Just reply to this email.

Thanks!

—
Autopilot America
      `.trim();
    } else {
      // First reminder - 45 days
      subject = '📋 Action Needed: Set Up Proof of Residency';
      body = `
Hi ${name},

Great news! Your city sticker renewal is scheduled for ${renewalDate}. To ensure we can renew your residential parking permit, we need you to set up automatic proof of residency.

This is a ONE-TIME setup that takes just 2 minutes.

🎯 Best Option: Email Forwarding (Recommended)
→ https://autopilotamerica.com/settings#residency-proof
→ Forward utility bills from your provider to us automatically
→ We'll always have fresh proof of residency
→ You'll never have to upload documents again

Alternative: Manual Upload
→ https://autopilotamerica.com/settings#residency-proof
→ Upload utility bill, bank statement, or lease
→ Must be dated within last 90 days
→ You'll need to do this again before next renewal

Why we need this:
The City of Chicago requires current proof of residency for parking permits. Email forwarding ensures we always have what we need without bothering you.

Questions? Reply to this email anytime.

Thanks for using Autopilot America!

—
Autopilot America
Automated parking permit renewals
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

    console.log(`✓ ${urgency} reminder sent to ${user.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}
