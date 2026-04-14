import { supabaseAdmin } from './supabase';
import { sendClickSendSMS, sendClickSendVoiceCall } from './sms-service';
import { Resend } from 'resend';
import { sendEmailWithRetry } from './resend-with-retry';
import {
  logMessageSent,
  logMessageSkipped,
  logMessageError,
  checkRecentlySent,
  type MessageContext
} from './message-audit-logger';
import { pushService, PushNotification, pushNotifications } from './push-service';
import { EMAIL, URLS, BRAND, FEATURES } from './config';
import { sms, email, voice, RenewalContext, UserContext } from './message-templates';

// Re-export push service for convenience
export { pushService, pushNotifications } from './push-service';

// Types for notifications
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  voice: boolean;
  reminder_days: number[];
}

export interface EmailNotification {
  to: string;
  subject: string;
  html: string;
  text: string;
  userId?: string;
  category?: string;
}

export interface SMSNotification {
  to: string;
  message: string;
  userId?: string;
  category?: string;
}

export interface VoiceNotification {
  to: string;
  message: string;
  userId?: string;
  category?: string;
}

export interface PushNotificationRequest {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  category?: string;
}

/**
 * NotificationService - Utility class for sending individual notifications
 * Used by various API endpoints for one-off notification sends
 */
export class NotificationService {
  private resend: Resend | null = null;

  constructor() {
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }
  }

  /**
   * Send an email via Resend
   */
  async sendEmail(notification: EmailNotification): Promise<boolean> {
    try {
      if (!this.resend || !process.env.RESEND_API_KEY || process.env.RESEND_API_KEY === 'your-resend-api-key-here' || process.env.RESEND_API_KEY.length < 10) {
        console.log('📧 MOCK: No valid Resend API key, would send email:', {
          to: notification.to,
          subject: notification.subject,
          preview: (notification.text || '').substring(0, 100) + '...'
        });
        return false; // Mock sends must not count as success
      }

      const fromAddress = EMAIL.FROM_DEFAULT;

      console.log('📧 Sending email via Resend:', {
        from: fromAddress,
        to: notification.to,
        subject: notification.subject
      });

      // Route through sendEmailWithRetry so we survive Resend's 2 req/sec
      // rate limit and transient 429s. Previously a single 429 on a
      // street-cleaning alert was a silent missed notification.
      const result = await sendEmailWithRetry(this.resend, {
        from: fromAddress,
        to: [notification.to],
        subject: notification.subject,
        html: notification.html,
        text: notification.text,
        headers: {
          'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
          'X-Entity-Ref-ID': crypto.randomUUID(),
        },
        replyTo: EMAIL.REPLY_TO,
      });

      if (!result.success) {
        console.error(`❌ Resend error after ${result.retries ?? 0} retries:`, result.error);
        return false;
      }

      if (result.retries && result.retries > 0) {
        console.log(`✅ Email sent successfully after ${result.retries} retries:`, result.data);
      } else {
        console.log('✅ Email sent successfully:', result.data);
      }
      return true;
    } catch (error) {
      console.error('Email sending failed:', error);
      return false;
    }
  }

  /**
   * Send an SMS via ClickSend
   */
  async sendSMS(notification: SMSNotification): Promise<boolean> {
    try {
      console.log('📱 Sending SMS via ClickSend:', {
        to: notification.to,
        length: notification.message.length + ' chars'
      });

      const result = await sendClickSendSMS(notification.to, notification.message);

      if (result.success) {
        console.log('✅ SMS sent successfully to', notification.to);
      } else {
        console.error('❌ SMS failed:', result.error);
      }

      return result.success;
    } catch (error) {
      console.error('SMS sending failed:', error);
      return false;
    }
  }

  /**
   * Send a voice call via ClickSend
   */
  async sendVoiceCall(notification: VoiceNotification): Promise<boolean> {
    try {
      console.log('📞 Making voice call via ClickSend:', {
        to: notification.to
      });

      const result = await sendClickSendVoiceCall(notification.to, notification.message);

      if (result.success) {
        console.log('✅ Voice call initiated successfully to', notification.to);
      } else {
        console.error('❌ Voice call failed:', result.error);
      }

      return result.success;
    } catch (error) {
      console.error('Voice call failed:', error);
      return false;
    }
  }

  /**
   * Send a push notification to a user
   */
  async sendPush(notification: PushNotificationRequest): Promise<boolean> {
    try {
      console.log('📱 Sending push notification to user:', notification.userId);

      const result = await pushService.sendToUser(notification.userId, {
        title: notification.title,
        body: notification.body,
        data: notification.data,
        category: notification.category
      });

      if (result.success) {
        console.log(`✅ Push sent to ${result.successCount} device(s)`);
        return true;
      } else {
        console.log('❌ Push notification failed - no devices or all failed');
        return false;
      }
    } catch (error) {
      console.error('❌ Push notification error:', error);
      return false;
    }
  }
}

// Singleton instance for NotificationService
export const notificationService = new NotificationService();

export class NotificationScheduler {
  private resend: Resend | null = null;
  private dryRun: boolean = false;

  constructor(options?: { dryRun?: boolean }) {
    // Initialize Resend for email
    if (process.env.RESEND_API_KEY) {
      this.resend = new Resend(process.env.RESEND_API_KEY);
    }

    // Shadow mode / test mode
    this.dryRun = options?.dryRun || false;

    if (this.dryRun) {
      console.log('🧪 RUNNING IN DRY RUN MODE - Messages will be logged but NOT sent');
    }
  }

  // Process reminders using the USERS table where data actually is
  async processPendingReminders(): Promise<{
    processed: number;
    successful: number;
    failed: number;
    errors: string[];
    dryRun?: boolean;
  }> {
    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    try {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0); // Set to UTC midnight for accurate day comparison
      console.log(`🔔 Checking for reminders on ${today.toISOString()}`);
      
      // Get ALL users with renewal dates from user_profiles table
      // Query for users with city sticker OR license plate expiry set
      // (emissions_date is handled separately - we don't charge for emissions, just remind)
      const { data: users, error } = await supabaseAdmin
        .from('user_profiles')
        .select('*')
        .or('city_sticker_expiry.not.is.null,license_plate_expiry.not.is.null');
        
      if (error) {
        console.error('Error fetching users:', error);
        return results;
      }
      
      console.log(`Found ${users?.length || 0} users with renewal dates`);

      // BATCH QUERIES: Pre-fetch permit docs and renewal payments to avoid N+1 queries
      // This reduces ~2000 queries to just 2 queries for 1000 users
      const userIds = (users || []).map(u => u.user_id);

      // Batch fetch permit zone documents for all users
      const { data: allPermitDocs } = userIds.length > 0 ? await supabaseAdmin
        .from('permit_zone_documents')
        .select('user_id, customer_code, verification_status, created_at')
        .in('user_id', userIds)
        .order('created_at', { ascending: false }) : { data: [] };

      // Create a map of user_id -> latest permit doc
      const permitDocsMap = new Map<string, { customer_code: string | null; verification_status: string | null }>();
      for (const doc of allPermitDocs || []) {
        // Only keep the first (most recent) doc for each user
        if (!permitDocsMap.has(doc.user_id)) {
          permitDocsMap.set(doc.user_id, {
            customer_code: doc.customer_code,
            verification_status: doc.verification_status
          });
        }
      }

      // Batch fetch renewal payments for all users (only paid ones)
      const { data: allPayments } = userIds.length > 0 ? await supabaseAdmin
        .from('renewal_payments')
        .select('user_id, renewal_type, due_date, city_payment_status, city_confirmation_number, paid_at')
        .in('user_id', userIds)
        .eq('city_payment_status', 'paid') : { data: [] };

      // Create a map of `${user_id}_${renewal_type}_${due_date}` -> payment
      const paymentsMap = new Map<string, boolean>();
      for (const payment of allPayments || []) {
        const key = `${payment.user_id}_${payment.renewal_type}_${payment.due_date}`;
        paymentsMap.set(key, true);
      }

      console.log(`Pre-fetched ${permitDocsMap.size} permit docs and ${paymentsMap.size} payments`);

      for (const user of users || []) {
        // Check if emissions test could block license plate renewal
        // This is CRITICAL: IL SOS won't process license plate renewal without completed emissions
        let emissionsBlocksRenewal = false;
        let daysUntilEmissions = 999;
        let daysUntilPlateExpiry = 999;

        if (user.emissions_date && user.license_plate_expiry) {
          const emissionsDate = new Date(user.emissions_date);
          const plateDate = new Date(user.license_plate_expiry);
          emissionsDate.setUTCHours(0, 0, 0, 0);
          plateDate.setUTCHours(0, 0, 0, 0);

          daysUntilEmissions = Math.floor((emissionsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          daysUntilPlateExpiry = Math.floor((plateDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

          // Emissions blocks renewal if:
          // 1. Emissions is NOT completed
          // 2. Both emissions and license plate are due within 60 days
          const emissionsCompleted = user.emissions_completed || false;
          if (!emissionsCompleted && daysUntilPlateExpiry <= 60 && daysUntilEmissions <= 60) {
            emissionsBlocksRenewal = true;
            console.log(`⚠️ EMISSIONS BLOCKS RENEWAL for ${user.email}: Emissions due in ${daysUntilEmissions} days, Plate due in ${daysUntilPlateExpiry} days`);
          }
        }

        // Check each renewal type
        // NOTE: Only City Sticker and License Plate can be auto-purchased
        // Emissions Test is reminder-only (user must bring car to testing facility)
        const renewals = [
          { date: user.city_sticker_expiry, type: 'City Sticker', canAutoPurchase: true },
          { date: user.license_plate_expiry, type: 'License Plate', canAutoPurchase: true },
          { date: user.emissions_date, type: 'Emissions Test', canAutoPurchase: false, blocksLicensePlate: emissionsBlocksRenewal }
        ];

        for (const renewal of renewals) {
          if (!renewal.date) continue;
          
          const dueDate = new Date(renewal.date);
          dueDate.setUTCHours(0, 0, 0, 0); // Normalize to UTC midnight for consistent comparison
          
          // Validate date to prevent "Invalid Date" in messages
          if (!dueDate || isNaN(dueDate.getTime())) {
            console.error(`Invalid renewal date for ${user.email}: ${renewal.date}`);
            continue;
          }
          
          const daysUntil = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          // Check if this matches a reminder day for the user
          // Sticker/plate reminders: people plan ahead for these (unlike street cleaning)
          const defaultReminderDays = [30, 14, 7, 3, 1];

          const reminderDays = user.notification_preferences?.reminder_days || defaultReminderDays;
          
          if (reminderDays.includes(daysUntil)) {
            results.processed++;
            console.log(`📅 User ${user.email} needs ${daysUntil}-day reminder for ${renewal.type}`);
            
            // Send notifications based on preferences
            try {
              const prefs = user.notification_preferences || {};

              // Build context data for audit logging
              const contextData: MessageContext = {
                plate: user.license_plate || 'unknown',
                zone: user.permit_zone || undefined,
                days_until: daysUntil,
                renewal_type: renewal.type,
                has_contesting: false,
                has_permit_zone: user.has_permit_zone || false
              };

              // Generate message key for deduplication
              const messageKey = `renewal_${renewal.type.toLowerCase().replace(/ /g, '_')}_${daysUntil}day`;

              // Send SMS if enabled
              // Check both notify_sms (direct column) and prefs.sms (legacy JSONB) for backwards compatibility
              const smsEnabled = user.notify_sms || prefs.sms;
              if (smsEnabled && user.phone_number) {
                // Check if we already sent this message recently (48h deduplication)
                const recentlySent = await checkRecentlySent(user.user_id, messageKey, 48);

                if (recentlySent) {
                  console.log(`⏭️  Skipping SMS - already sent within 48h: ${messageKey}`);
                  await logMessageSkipped({
                    userId: user.user_id,
                    userEmail: user.email,
                    userPhone: user.phone_number,
                    messageKey,
                    messageChannel: 'sms',
                    contextData,
                    reason: 'already_sent_48h'
                  });
                  // Don't send, continue to next notification type
                } else {
                  // Build renewal context for templates
                  const renewalCtx: RenewalContext = {
                    renewalType: renewal.type as RenewalContext['renewalType'],
                    daysUntil,
                    dueDate,
                    hasProtection: false,
                    profileConfirmed: user.profile_confirmed_at !== null,
                    actuallyPurchased: false,
                    needsPermitDocs: false,
                    blocksLicensePlate: renewal.type === 'Emissions Test' && 'blocksLicensePlate' in renewal && renewal.blocksLicensePlate
                  };

                  // Use centralized SMS templates — all users get reminder-style messages
                  const message = sms.renewalFree(renewalCtx);

                  if (this.dryRun) {
                    // DRY RUN MODE: Log what WOULD be sent but don't actually send
                    console.log(`🧪 [DRY RUN] Would send SMS to ${user.phone_number}: ${message}`);
                    results.successful++;

                    // Log as "queued" in dry run mode
                    await logMessageSent({
                      userId: user.user_id,
                      userEmail: user.email,
                      userPhone: user.phone_number,
                      messageKey,
                      messageChannel: 'sms',
                      contextData,
                      messagePreview: `[DRY RUN] ${message}`,
                      externalMessageId: `dryrun-${Date.now()}`,
                      costCents: 2
                    });
                  } else {
                    // LIVE MODE: Actually send the SMS
                    console.log(`📱 Sending SMS to ${user.phone_number}: ${message}`);
                    const smsResult = await sendClickSendSMS(user.phone_number, message);

                    if (smsResult.success) {
                      console.log('✅ SMS sent successfully');
                      results.successful++;

                      // Log successful send
                      await logMessageSent({
                        userId: user.user_id,
                        userEmail: user.email,
                        userPhone: user.phone_number,
                        messageKey,
                        messageChannel: 'sms',
                        contextData,
                        messagePreview: message,
                        externalMessageId: smsResult.messageId,
                        costCents: 2 // SMS typically costs ~2 cents
                      });
                    } else {
                      console.error('❌ SMS failed:', smsResult.error);
                      results.failed++;

                      // Log error
                      await logMessageError({
                        userId: user.user_id,
                        userEmail: user.email,
                        userPhone: user.phone_number,
                        messageKey,
                        messageChannel: 'sms',
                        contextData,
                        reason: 'api_error',
                        errorDetails: { error: smsResult.error }
                      });
                    }
                  }
                }
              } else if (smsEnabled && !user.phone_number) {
                // SMS enabled but no phone number
                await logMessageSkipped({
                  userId: user.user_id,
                  userEmail: user.email,
                  userPhone: undefined,
                  messageKey,
                  messageChannel: 'sms',
                  contextData,
                  reason: 'missing_phone_number'
                });
              } else if (!smsEnabled && user.phone_number) {
                // Has phone but SMS disabled in preferences
                await logMessageSkipped({
                  userId: user.user_id,
                  userEmail: user.email,
                  userPhone: user.phone_number,
                  messageKey,
                  messageChannel: 'sms',
                  contextData,
                  reason: 'user_disabled_sms'
                });
              }

              // Send voice call if enabled
              const voiceEnabled = user.phone_call_enabled || prefs.voice;
              if (voiceEnabled && user.phone_number) {
                // Check if we already sent this voice message recently
                const voiceMessageKey = `${messageKey}_voice`;
                const recentlyCalledVoice = await checkRecentlySent(user.user_id, voiceMessageKey, 48);

                if (recentlyCalledVoice) {
                  console.log(`⏭️  Skipping voice call - already sent within 48h: ${voiceMessageKey}`);
                  await logMessageSkipped({
                    userId: user.user_id,
                    userEmail: user.email,
                    userPhone: user.phone_number,
                    messageKey: voiceMessageKey,
                    messageChannel: 'voice',
                    contextData,
                    reason: 'already_sent_48h'
                  });
                } else {
                  // Use centralized voice template
                  const voiceMessage = voice.renewalReminder(
                    renewal.type as RenewalContext['renewalType'],
                    daysUntil,
                    dueDate
                  );

                  if (this.dryRun) {
                    // DRY RUN MODE: Log what WOULD be sent
                    console.log(`🧪 [DRY RUN] Would send voice call to ${user.phone_number}: ${voiceMessage.substring(0, 50)}...`);
                    results.successful++;

                    await logMessageSent({
                      userId: user.user_id,
                      userEmail: user.email,
                      userPhone: user.phone_number,
                      messageKey: voiceMessageKey,
                      messageChannel: 'voice',
                      contextData,
                      messagePreview: `[DRY RUN] ${voiceMessage}`,
                      externalMessageId: `dryrun-${Date.now()}`,
                      costCents: 5
                    });
                  } else {
                    // LIVE MODE: Actually send voice call
                    console.log(`📞 Sending voice call to ${user.phone_number}: ${voiceMessage.substring(0, 50)}...`);
                    const voiceResult = await sendClickSendVoiceCall(user.phone_number, voiceMessage);

                    if (voiceResult.success) {
                      console.log('✅ Voice call sent successfully');
                      results.successful++;

                      // Log successful voice call
                      await logMessageSent({
                        userId: user.user_id,
                        userEmail: user.email,
                        userPhone: user.phone_number,
                        messageKey: voiceMessageKey,
                        messageChannel: 'voice',
                        contextData,
                        messagePreview: voiceMessage,
                        externalMessageId: voiceResult.messageId,
                        costCents: 5 // Voice typically costs ~5 cents
                      });
                    } else {
                      console.error('❌ Voice call failed:', voiceResult.error);
                      results.failed++;

                      // Log error
                      await logMessageError({
                        userId: user.user_id,
                        userEmail: user.email,
                        userPhone: user.phone_number,
                        messageKey: voiceMessageKey,
                        messageChannel: 'voice',
                        contextData,
                        reason: 'api_error',
                        errorDetails: { error: voiceResult.error }
                      });
                    }
                  }
                }
              } else if (voiceEnabled && !user.phone_number) {
                // Voice enabled but no phone number
                await logMessageSkipped({
                  userId: user.user_id,
                  userEmail: user.email,
                  userPhone: undefined,
                  messageKey: `${messageKey}_voice`,
                  messageChannel: 'voice',
                  contextData,
                  reason: 'missing_phone_number'
                });
              }
              
              // Email is sent if user has email enabled (defaults to true if not set)
              // Check both notify_email (direct column) and prefs.email (legacy JSONB) for backwards compatibility
              const emailEnabled = user.notify_email !== false && prefs.email !== false;
              if (emailEnabled && user.email && this.resend) {
                try {
                  const fromAddress = EMAIL.FROM_DEFAULT;

                  // Build contexts for email templates
                  const emailRenewalCtx: RenewalContext = {
                    renewalType: renewal.type as RenewalContext['renewalType'],
                    daysUntil,
                    dueDate,
                    hasProtection: false,
                    profileConfirmed: user.profile_confirmed_at !== null,
                    actuallyPurchased: false,
                    needsPermitDocs: false,
                    blocksLicensePlate: renewal.type === 'Emissions Test' && 'blocksLicensePlate' in renewal && renewal.blocksLicensePlate
                  };

                  const userCtx: UserContext = {
                    firstName: user.first_name,
                    email: user.email,
                    phone: user.phone_number,
                    licensePlate: user.license_plate
                  };

                  // Use centralized email templates — all users get reminder-style messages
                  const emailContent = email.renewalFree(emailRenewalCtx);

                  const emailSubject = emailContent.subject;
                  const emailHtml = emailContent.html;
                  const emailText = emailContent.text;

                  // Check if we already sent this email recently
                  const emailMessageKey = `${messageKey}_email`;
                  const recentlySentEmail = await checkRecentlySent(user.user_id, emailMessageKey, 48);

                  if (recentlySentEmail) {
                    console.log(`⏭️  Skipping email - already sent within 48h: ${emailMessageKey}`);
                    await logMessageSkipped({
                      userId: user.user_id,
                      userEmail: user.email,
                      userPhone: user.phone_number,
                      messageKey: emailMessageKey,
                      messageChannel: 'email',
                      contextData,
                      reason: 'already_sent_48h'
                    });
                  } else {
                    if (this.dryRun) {
                      // DRY RUN MODE: Log what WOULD be sent
                      console.log(`🧪 [DRY RUN] Would send email to ${user.email}: ${emailSubject}`);
                      results.successful++;

                      await logMessageSent({
                        userId: user.user_id,
                        userEmail: user.email,
                        userPhone: user.phone_number,
                        messageKey: emailMessageKey,
                        messageChannel: 'email',
                        contextData,
                        messagePreview: `[DRY RUN] ${emailSubject}`,
                        externalMessageId: `dryrun-${Date.now()}`,
                        costCents: 0
                      });
                    } else {
                      // LIVE MODE: Actually send email
                      console.log(`📧 Sending email to ${user.email}: ${emailSubject}`);

                      const sendResult = await sendEmailWithRetry(this.resend, {
                        from: fromAddress,
                        to: [user.email],
                        subject: emailSubject,
                        html: emailHtml,
                        text: emailText,
                        headers: {
                          'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
                        },
                        replyTo: EMAIL.REPLY_TO,
                      });

                      // Preserve the previous shape so downstream logging
                      // keeps working unchanged.
                      const data = sendResult.data;
                      const emailError = sendResult.success ? null : (sendResult.error || 'send failed');
                      if (sendResult.retries && sendResult.retries > 0) {
                        console.log(`  (recovered after ${sendResult.retries} retries)`);
                      }

                      if (emailError) {
                        console.error(`❌ Email failed after ${sendResult.retries ?? 0} retries:`, emailError);
                        results.failed++;

                        // Log email error
                        await logMessageError({
                          userId: user.user_id,
                          userEmail: user.email,
                          userPhone: user.phone_number,
                          messageKey: emailMessageKey,
                          messageChannel: 'email',
                          contextData,
                          reason: 'api_error',
                          errorDetails: { error: emailError, retries: sendResult.retries ?? 0 }
                        });
                      } else {
                        console.log('✅ Email sent successfully:', data);
                        results.successful++;

                        // Log successful email send
                        await logMessageSent({
                          userId: user.user_id,
                          userEmail: user.email,
                          userPhone: user.phone_number,
                          messageKey: emailMessageKey,
                          messageChannel: 'email',
                          contextData,
                          messagePreview: emailSubject, // Use subject as preview
                          externalMessageId: data?.id,
                          costCents: 0 // Email typically costs ~0.1 cents but we'll round to 0
                        });
                      }
                    }
                  }
                } catch (emailError) {
                  console.error('❌ Email exception:', emailError);
                  results.failed++;

                  // Log exception
                  await logMessageError({
                    userId: user.user_id,
                    userEmail: user.email,
                    userPhone: user.phone_number,
                    messageKey: `${messageKey}_email`,
                    messageChannel: 'email',
                    contextData,
                    reason: 'exception',
                    errorDetails: { error: emailError }
                  });
                }
              } else if (user.email && !this.resend) {
                console.log(`📧 Resend not configured, skipping email for ${user.email}`);
                await logMessageSkipped({
                  userId: user.user_id,
                  userEmail: user.email,
                  userPhone: user.phone_number,
                  messageKey: `${messageKey}_email`,
                  messageChannel: 'email',
                  contextData,
                  reason: 'resend_not_configured'
                });
              } else if (!user.email) {
                // User has no email address
                await logMessageSkipped({
                  userId: user.user_id,
                  userEmail: undefined,
                  userPhone: user.phone_number,
                  messageKey: `${messageKey}_email`,
                  messageChannel: 'email',
                  contextData,
                  reason: 'missing_email'
                });
              } else if (!emailEnabled) {
                // User has disabled email notifications
                console.log(`📧 Email disabled by user preference, skipping for ${user.email}`);
                await logMessageSkipped({
                  userId: user.user_id,
                  userEmail: user.email,
                  userPhone: user.phone_number,
                  messageKey: `${messageKey}_email`,
                  messageChannel: 'email',
                  contextData,
                  reason: 'user_disabled_email'
                });
              }
              
            } catch (error) {
              console.error(`Error sending notification to ${user.email}:`, error);
              results.failed++;
              results.errors.push(`Failed to notify ${user.email}: ${error}`);
            }
          }
        }
      }
      
    } catch (error) {
      console.error('Fatal error in processPendingReminders:', error);
      results.errors.push(`Fatal error: ${error}`);
    }
    
    const modeLabel = this.dryRun ? '[DRY RUN]' : '';
    console.log(`📊 ${modeLabel} Notification Results: ${results.successful} sent, ${results.failed} failed, ${results.processed} processed`);

    return {
      ...results,
      dryRun: this.dryRun
    };
  }
}

export const notificationScheduler = new NotificationScheduler();

// Export factory function for creating scheduler with options
export function createNotificationScheduler(options?: { dryRun?: boolean }) {
  return new NotificationScheduler(options);
}
