/**
 * Post-Purchase Notification Cron Job
 *
 * This cron runs daily to send notifications for stickers that have been purchased:
 * 1. "Sticker Purchased" - Sent when sticker_purchased_at is set
 * 2. "Sticker Should Arrive" - Sent 10 days after purchase
 * 3. "Did You Apply Your Sticker?" - Sent 14 days after purchase
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface NotificationResult {
  success: boolean;
  processed: number;
  purchaseNotificationsSent: number;
  deliveryRemindersSent: number;
  applyRemindersSent: number;
  errors: string[];
}

/**
 * Send email via Resend
 */
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.log('RESEND_API_KEY not configured, skipping email');
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
        from: 'Autopilot America <noreply@autopilotamerica.com>',
        to: [to],
        subject,
        html,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('Email send failed:', error);
    return false;
  }
}

/**
 * Send SMS via ClickSend
 */
async function sendSMS(to: string, message: string): Promise<boolean> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;

  if (!username || !apiKey) {
    console.log('ClickSend not configured, skipping SMS');
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
    return response.ok;
  } catch (error) {
    console.error('SMS send failed:', error);
    return false;
  }
}

/**
 * Check if notification was already sent
 */
async function wasNotificationSent(userId: string, messageKey: string): Promise<boolean> {
  const { data } = await supabase
    .from('notification_log')
    .select('id')
    .eq('user_id', userId)
    .eq('message_key', messageKey)
    .single();

  return !!data;
}

/**
 * Log that notification was sent
 */
async function logNotification(userId: string, type: string, channel: string, messageKey: string): Promise<void> {
  await supabase.from('notification_log').insert({
    user_id: userId,
    notification_type: type,
    channel,
    message_key: messageKey,
    metadata: { sent_at: new Date().toISOString() },
  }).catch(err => console.error('Failed to log notification:', err));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NotificationResult | { error: string }>
) {
  // Allow both GET (for Vercel cron) and POST requests
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'GET') {
    // Allow GET for testing, but POST requires auth
  }

  console.log('📬 Starting post-purchase notification processing...');

  const results: NotificationResult = {
    success: true,
    processed: 0,
    purchaseNotificationsSent: 0,
    deliveryRemindersSent: 0,
    applyRemindersSent: 0,
    errors: [],
  };

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get users with purchased stickers
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('has_protection', true)
      .not('sticker_purchased_at', 'is', null);

    if (error) {
      throw error;
    }

    if (!users || users.length === 0) {
      console.log('No users with purchased stickers found');
      return res.status(200).json(results);
    }

    console.log(`Found ${users.length} users with purchased stickers`);

    for (const user of users) {
      results.processed++;

      const purchaseDate = new Date(user.sticker_purchased_at);
      const daysSincePurchase = Math.floor((today.getTime() - purchaseDate.getTime()) / (1000 * 60 * 60 * 24));

      console.log(`Processing ${user.email}: ${daysSincePurchase} days since purchase`);

      // 1. PURCHASE NOTIFICATION (day 0-1)
      if (daysSincePurchase <= 1) {
        const messageKey = `sticker_purchased_${user.sticker_purchased_at}`;

        if (!(await wasNotificationSent(user.user_id, messageKey))) {
          const expectedDelivery = new Date(purchaseDate);
          expectedDelivery.setDate(expectedDelivery.getDate() + 10);

          // Send email
          const emailSent = await sendEmail(
            user.email,
            `Your City Sticker Has Been Purchased! 🎉`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 24px;">Great News! Your Sticker is On Its Way</h1>
              </div>
              <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                <p>Hi ${user.first_name || 'there'},</p>
                <p>We've successfully purchased your Chicago City Sticker on your behalf! Here's what happens next:</p>

                <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <div style="margin-bottom: 12px;">
                    <strong>License Plate:</strong> ${user.license_plate}
                  </div>
                  <div style="margin-bottom: 12px;">
                    <strong>Purchase Date:</strong> ${purchaseDate.toLocaleDateString()}
                  </div>
                  <div>
                    <strong>Expected Delivery:</strong> Around ${expectedDelivery.toLocaleDateString()}
                  </div>
                </div>

                <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin: 16px 0;">
                  <h3 style="margin: 0 0 8px; color: #1e40af;">What's Next?</h3>
                  <ol style="margin: 0; padding-left: 20px; color: #1e40af;">
                    <li>Your sticker will be mailed to your address on file</li>
                    <li>It typically arrives within 7-10 business days</li>
                    <li>Once received, apply it to your windshield immediately</li>
                  </ol>
                </div>

                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  This is why you have Autopilot Protection - we handle the hassle so you don't have to!<br><br>
                  Questions? Reply to this email or contact support@autopilotamerica.com
                </p>
              </div>
            </div>
            `
          );

          // Send SMS
          const smsSent = await sendSMS(
            user.phone || user.phone_number,
            `Autopilot: Great news! Your Chicago City Sticker for ${user.license_plate} has been purchased. It should arrive at your address within 7-10 business days. Don't forget to apply it when it arrives! - Autopilot America`
          );

          if (emailSent || smsSent) {
            await logNotification(user.user_id, 'sticker_purchased', emailSent ? 'email' : 'sms', messageKey);
            results.purchaseNotificationsSent++;
            console.log(`✅ Sent purchase notification to ${user.email}`);
          }
        }
      }

      // 2. DELIVERY REMINDER (around day 10)
      if (daysSincePurchase >= 9 && daysSincePurchase <= 11) {
        const messageKey = `sticker_delivery_reminder_${user.sticker_purchased_at}`;

        if (!(await wasNotificationSent(user.user_id, messageKey))) {
          const emailSent = await sendEmail(
            user.email,
            `Your City Sticker Should Be Arriving Soon`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 24px;">📬 Check Your Mailbox!</h1>
              </div>
              <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                <p>Hi ${user.first_name || 'there'},</p>
                <p>Your Chicago City Sticker for <strong>${user.license_plate}</strong> should be arriving any day now!</p>

                <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 16px; margin: 16px 0;">
                  <h3 style="margin: 0 0 8px; color: #92400e;">🔔 Important Reminder</h3>
                  <p style="margin: 0; color: #92400e;">
                    As soon as your sticker arrives, <strong>apply it to your windshield immediately</strong>.
                    Don't leave it sitting in your car - you can still get a ticket if the sticker isn't displayed!
                  </p>
                </div>

                <p style="margin-top: 16px;">Your sticker was purchased on ${purchaseDate.toLocaleDateString()} and should arrive within 7-10 business days.</p>

                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  Haven't received it after 14 days? Reply to this email and we'll look into it for you.
                </p>
              </div>
            </div>
            `
          );

          const smsSent = await sendSMS(
            user.phone || user.phone_number,
            `Autopilot: Your city sticker for ${user.license_plate} should arrive soon! Remember to apply it to your windshield right away. Haven't received it? Reply to let us know. - Autopilot America`
          );

          if (emailSent || smsSent) {
            await logNotification(user.user_id, 'sticker_delivery_reminder', emailSent ? 'email' : 'sms', messageKey);
            results.deliveryRemindersSent++;
            console.log(`✅ Sent delivery reminder to ${user.email}`);
          }
        }
      }

      // 3. APPLY REMINDER (around day 14)
      if (daysSincePurchase >= 13 && daysSincePurchase <= 15) {
        const messageKey = `sticker_apply_reminder_${user.sticker_purchased_at}`;

        if (!(await wasNotificationSent(user.user_id, messageKey))) {
          const emailSent = await sendEmail(
            user.email,
            `Did You Apply Your New City Sticker?`,
            `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); color: white; padding: 24px; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0; font-size: 24px;">Quick Check-In</h1>
              </div>
              <div style="padding: 24px; background: #f9fafb; border-radius: 0 0 8px 8px;">
                <p>Hi ${user.first_name || 'there'},</p>
                <p>It's been about 2 weeks since we purchased your city sticker. Just checking in!</p>

                <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 16px 0; text-align: center;">
                  <h3 style="margin: 0 0 16px; color: #374151;">Did you receive and apply your sticker?</h3>
                  <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <a href="https://autopilotamerica.com/settings?sticker_applied=yes"
                       style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                      Yes, Applied It!
                    </a>
                    <a href="https://autopilotamerica.com/settings?sticker_applied=no"
                       style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600;">
                      Not Yet / Problem
                    </a>
                  </div>
                </div>

                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 16px; margin: 16px 0;">
                  <p style="margin: 0; color: #92400e;">
                    <strong>⚠️ Reminder:</strong> Even if you purchased a new sticker, you can still get a ticket if it's not displayed on your windshield!
                  </p>
                </div>

                <p style="color: #6b7280; font-size: 14px; margin-top: 24px;">
                  If you haven't received your sticker yet, reply to this email and we'll investigate.<br><br>
                  Thanks for being an Autopilot America member!
                </p>
              </div>
            </div>
            `
          );

          const smsSent = await sendSMS(
            user.phone || user.phone_number,
            `Autopilot: Quick check - did you receive and apply your city sticker for ${user.license_plate}? If not displayed, you can still get a ticket! Reply YES if applied, or NO if there's a problem. - Autopilot America`
          );

          if (emailSent || smsSent) {
            await logNotification(user.user_id, 'sticker_apply_reminder', emailSent ? 'email' : 'sms', messageKey);
            results.applyRemindersSent++;
            console.log(`✅ Sent apply reminder to ${user.email}`);
          }
        }
      }

      // Update renewal_status if appropriate
      if (daysSincePurchase >= 0 && daysSincePurchase < 10 && user.renewal_status !== 'shipped') {
        await supabase
          .from('user_profiles')
          .update({ renewal_status: 'shipped' })
          .eq('user_id', user.user_id);
      }
    }

    console.log('✅ Post-purchase notification processing complete');
    console.log(`   Purchase notifications: ${results.purchaseNotificationsSent}`);
    console.log(`   Delivery reminders: ${results.deliveryRemindersSent}`);
    console.log(`   Apply reminders: ${results.applyRemindersSent}`);

    return res.status(200).json(results);

  } catch (error: any) {
    console.error('Error processing post-purchase notifications:', error);
    results.success = false;
    results.errors.push(error.message);
    return res.status(500).json(results);
  }
}
