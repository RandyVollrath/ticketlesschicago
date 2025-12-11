import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron Job: Remind permit users to set up email forwarding for residency proof
 *
 * Sends reminders to users who:
 * - Have permit zones and requested permits
 * - Haven't configured email forwarding yet
 * - Haven't uploaded manual residency proof
 *
 * Reminders at: 2 days, 5 days, 10 days after Protection signup
 *
 * Schedule: Daily at 11 AM CT
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

    console.log('📧 Checking for users needing email forwarding setup...');

    const today = new Date();
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(today.getDate() - 10);

    // Get permit users who haven't set up email forwarding
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, first_name, last_name, created_at, residency_proof_path')
      .eq('has_protection', true)
      .eq('has_permit_zone', true)
      .eq('permit_requested', true)
      .eq('email_forwarding_configured', false)
      .gte('created_at', tenDaysAgo.toISOString());

    if (usersError) {
      throw usersError;
    }

    console.log(`Found ${users?.length || 0} permit users without email forwarding`);

    let notified2Days = 0;
    let notified5Days = 0;
    let notified10Days = 0;
    const errors: any[] = [];

    for (const user of users || []) {
      try {
        const createdDate = new Date(user.created_at);
        const daysSinceSignup = Math.floor((today.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));

        // Skip if they already uploaded manual proof
        if (user.residency_proof_path) {
          console.log(`User ${user.user_id}: Has manual proof uploaded, skipping`);
          continue;
        }

        // Send reminders at specific intervals
        let shouldNotify = false;
        let reminderDay: 2 | 5 | 10 | null = null;

        if (daysSinceSignup >= 10 && daysSinceSignup <= 11) {
          shouldNotify = true;
          reminderDay = 10;
        } else if (daysSinceSignup >= 5 && daysSinceSignup <= 6) {
          shouldNotify = true;
          reminderDay = 5;
        } else if (daysSinceSignup >= 2 && daysSinceSignup <= 3) {
          shouldNotify = true;
          reminderDay = 2;
        }

        if (!shouldNotify || !reminderDay) {
          continue;
        }

        console.log(`Sending day-${reminderDay} email forwarding reminder to user ${user.user_id}`);

        const emailSent = await sendEmailForwardingReminder(user, reminderDay);

        if (emailSent) {
          if (reminderDay === 2) notified2Days++;
          else if (reminderDay === 5) notified5Days++;
          else notified10Days++;
        }
      } catch (error: any) {
        console.error(`Error processing user ${user.user_id}:`, error);
        errors.push({
          userId: user.user_id,
          error: sanitizeErrorMessage(error),
        });
      }
    }

    const totalNotified = notified2Days + notified5Days + notified10Days;

    return res.status(200).json({
      success: true,
      message: `Sent ${totalNotified} email forwarding reminders`,
      breakdown: {
        day2: notified2Days,
        day5: notified5Days,
        day10: notified10Days,
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

async function sendEmailForwardingReminder(
  user: any,
  reminderDay: 2 | 5 | 10
): Promise<boolean> {
  try {
    const name = user.first_name || 'there';

    let subject = '';
    let body = '';

    if (reminderDay === 2) {
      subject = '🅿️ Set Up Email Forwarding (2 Minutes) - Parking Permit';
      body = `
Hi ${name},

You requested a residential parking permit! To make permit renewals completely automatic, we recommend setting up email forwarding for your utility bills.

🎯 Why Email Forwarding is Better:

✓ Set it once, never upload documents again
✓ We automatically get fresh proof of residency
✓ Takes just 2 minutes to set up
✓ Works with ComEd, Peoples Gas, Xfinity, AT&T, etc.

⚡ Set Up Now (2 minutes):
→ https://autopilotamerica.com/settings#residency-proof

How it works:
1. Log into your utility provider (ComEd, Peoples Gas, etc.)
2. Set bills to auto-forward to your unique email
3. Done! We'll automatically receive fresh bills every month

Alternative: Manual Upload
If you prefer, you can upload a utility bill manually:
→ https://autopilotamerica.com/settings#residency-proof
→ Must be dated within last 90 days
→ You'll need to re-upload before each renewal

Questions? Reply to this email.

Thanks!

—
Autopilot America
      `.trim();
    } else if (reminderDay === 5) {
      subject = '⏰ Reminder: Email Forwarding Setup - Parking Permit';
      body = `
Hi ${name},

Quick reminder: Setting up email forwarding for your utility bills ensures smooth parking permit renewals.

🎯 2-Minute Setup (Recommended):
→ https://autopilotamerica.com/settings#residency-proof

Why this matters:
• The city requires current proof of residency for permits
• Email forwarding means you never have to upload documents
• We'll always have fresh bills when renewals come up

Supported providers:
✓ ComEd, Peoples Gas
✓ Xfinity, AT&T, RCN
✓ Water bill, bank statements
✓ Any email-based billing

Set it up now:
https://autopilotamerica.com/settings#residency-proof

Or upload manually (but you'll need to do it again later):
https://autopilotamerica.com/settings#residency-proof

Questions? Just reply.

—
Autopilot America
      `.trim();
    } else {
      // Day 10 - final gentle reminder
      subject = '📋 Final Reminder: Proof of Residency Setup';
      body = `
Hi ${name},

This is our final reminder about setting up proof of residency for your parking permit.

⚡ Quick Options:

Option 1: Email Forwarding (Recommended)
→ https://autopilotamerica.com/settings#residency-proof
→ 2-minute setup, never upload again
→ Completely automatic

Option 2: Manual Upload
→ https://autopilotamerica.com/settings#residency-proof
→ Upload utility bill, bank statement, or lease
→ Must be within last 90 days
→ You'll need to re-upload before each renewal

⚠️  Without this, we cannot renew your parking permit.

This is the last reminder we'll send about this. When your renewal approaches (30 days before), we'll send urgent reminders if we still don't have proof of residency.

Complete setup now:
https://autopilotamerica.com/settings#residency-proof

Questions? Reply anytime.

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

    console.log(`✓ Day-${reminderDay} email forwarding reminder sent to ${user.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}
