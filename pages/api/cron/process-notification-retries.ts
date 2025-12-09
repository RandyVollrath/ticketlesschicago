/**
 * Cron Job: Process Notification Retries
 *
 * Processes failed notifications that are scheduled for retry.
 * Uses exponential backoff (5min, 10min, 20min) with max 3 attempts.
 *
 * Schedule: Every 5 minutes
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { notificationLogger } from '../../../lib/notification-logger';
import { notificationService } from '../../../lib/notifications';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret for security
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (cronSecret !== process.env.CRON_SECRET && process.env.NODE_ENV === 'production') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🔄 Starting notification retry processing...');

  const results = {
    processed: 0,
    successful: 0,
    failed: 0,
    permanentlyFailed: 0,
    errors: [] as string[]
  };

  try {
    // Get pending retries (notifications that failed and are due for retry)
    const pendingRetries = await notificationLogger.getPendingRetries(50);

    console.log(`Found ${pendingRetries.length} notifications to retry`);

    for (const notification of pendingRetries) {
      results.processed++;

      try {
        // Increment attempt count
        await notificationLogger.incrementRetryAttempt(notification.id);

        let success = false;
        let errorMessage: string | undefined;

        // Retry based on notification type
        switch (notification.notification_type) {
          case 'email':
            if (notification.email) {
              // Reconstruct email from metadata if available
              const emailContent = notification.metadata?.email_content as {
                subject?: string;
                html?: string;
                text?: string;
              } | undefined;

              if (emailContent) {
                success = await notificationService.sendEmail({
                  to: notification.email,
                  subject: emailContent.subject || notification.subject,
                  html: emailContent.html || notification.content_preview,
                  text: emailContent.text || notification.content_preview
                });
              } else {
                // Fallback: send a simple notification that the original failed
                success = await notificationService.sendEmail({
                  to: notification.email,
                  subject: `[Retry] ${notification.subject}`,
                  html: `<p>This is a retry of a previously failed notification.</p><p>${notification.content_preview}</p>`,
                  text: `[Retry] ${notification.content_preview}`
                });
              }

              if (!success) {
                errorMessage = 'Email send failed on retry';
              }
            }
            break;

          case 'sms':
            if (notification.phone) {
              const smsContent = notification.metadata?.sms_content as string | undefined;
              success = await notificationService.sendSMS({
                to: notification.phone,
                message: smsContent || notification.content_preview
              });

              if (!success) {
                errorMessage = 'SMS send failed on retry';
              }
            }
            break;

          case 'voice':
            if (notification.phone) {
              const voiceContent = notification.metadata?.voice_content as string | undefined;
              success = await notificationService.sendVoiceCall({
                to: notification.phone,
                message: voiceContent || notification.content_preview
              });

              if (!success) {
                errorMessage = 'Voice call failed on retry';
              }
            }
            break;

          default:
            errorMessage = `Unknown notification type: ${notification.notification_type}`;
        }

        // Update status based on result
        if (success) {
          await notificationLogger.updateStatus(notification.id, 'sent');
          results.successful++;
          console.log(`✅ Retry successful for ${notification.notification_type} to ${notification.email || notification.phone}`);
        } else {
          // Check if this was the last attempt
          if (notification.attempt_count >= 3) {
            await notificationLogger.updateStatus(notification.id, 'failed', undefined, errorMessage);
            results.permanentlyFailed++;
            console.log(`❌ Permanently failed after ${notification.attempt_count} attempts: ${notification.email || notification.phone}`);
          } else {
            await notificationLogger.updateStatus(notification.id, 'failed', undefined, errorMessage);
            results.failed++;
            console.log(`⚠️ Retry ${notification.attempt_count} failed, will retry again: ${notification.email || notification.phone}`);
          }
        }
      } catch (error) {
        results.failed++;
        const errorMsg = `Error retrying notification ${notification.id}: ${error}`;
        results.errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
  } catch (error) {
    const errorMsg = `Error in retry processing: ${error}`;
    results.errors.push(errorMsg);
    console.error(errorMsg);
  }

  console.log('📊 Retry processing complete:', results);

  return res.status(200).json({
    success: true,
    results
  });
}
