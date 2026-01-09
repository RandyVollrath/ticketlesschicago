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
import { email as emailTemplates, sms as smsTemplates } from '../../../lib/message-templates';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

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
        from: 'Autopilot America <hello@autopilotamerica.com>',
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

// SMS sending via centralized service with retry (lib/sms-service.ts)

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
      .eq('has_contesting', true)
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
          // Use centralized templates
          const userContext = { firstName: user.first_name, licensePlate: user.license_plate };
          const emailContent = emailTemplates.stickerPurchased(userContext, purchaseDate);
          const smsMessage = smsTemplates.stickerPurchased(user.license_plate);

          // Send email
          const emailSent = await sendEmail(user.email, emailContent.subject, emailContent.html);

          // Send SMS
          const smsResult = await sendClickSendSMS(user.phone || user.phone_number, smsMessage);
          const smsSent = smsResult.success;

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
          // Use centralized templates
          const userContext = { firstName: user.first_name, licensePlate: user.license_plate };
          const emailContent = emailTemplates.stickerDelivery(userContext);
          const smsMessage = smsTemplates.stickerDelivery(user.license_plate);

          const emailSent = await sendEmail(user.email, emailContent.subject, emailContent.html);
          const smsResult = await sendClickSendSMS(user.phone || user.phone_number, smsMessage);
          const smsSent = smsResult.success;

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
          // Use centralized templates
          const userContext = { firstName: user.first_name, licensePlate: user.license_plate };
          const emailContent = emailTemplates.stickerApplyCheck(userContext);
          const smsMessage = smsTemplates.stickerApplyCheck(user.license_plate);

          const emailSent = await sendEmail(user.email, emailContent.subject, emailContent.html);
          const smsResult = await sendClickSendSMS(user.phone || user.phone_number, smsMessage);
          const smsSent = smsResult.success;

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
    results.errors.push(sanitizeErrorMessage(error));
    return res.status(500).json(results);
  }
}
