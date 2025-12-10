/**
 * Emissions Test Reminder Cron Job
 *
 * Illinois requires a valid emissions test to renew license plates.
 * This cron sends proactive reminders so users complete their test in time.
 *
 * Schedule: Daily
 * Reminders sent at: 90, 60, 45, 30, 14, 7, 3, 1 days before emissions deadline
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { email as emailTemplates, sms as smsTemplates, voice as voiceTemplates, getUrgencyLevel } from '../../../lib/message-templates';
import { sendClickSendSMS, sendClickSendVoiceCall } from '../../../lib/sms-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface NotificationResult {
  success: boolean;
  processed: number;
  notificationsSent: number;
  errors: string[];
}

// Default reminder days if user hasn't configured notify_days_array
// Keep it minimal - just the critical ones
const DEFAULT_REMINDER_DAYS = [30, 7, 1];

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

// SMS and Voice calls via centralized service with retry (lib/sms-service.ts)

// generateVoiceContent - using centralized template voiceTemplates.emissionsReminder()

/**
 * Check if notification was already sent
 */
async function wasNotificationSent(userId: string, messageKey: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from('notification_log')
      .select('id')
      .eq('user_id', userId)
      .eq('message_key', messageKey)
      .single();
    return !!data;
  } catch {
    return false; // Table might not exist yet
  }
}

/**
 * Log that notification was sent
 */
async function logNotification(userId: string, type: string, channel: string, messageKey: string, daysUntil: number): Promise<void> {
  await supabase.from('notification_log').insert({
    user_id: userId,
    notification_type: type,
    channel,
    message_key: messageKey,
    metadata: {
      sent_at: new Date().toISOString(),
      days_until_deadline: daysUntil
    },
  }).catch(err => console.log('Note: Could not log notification'));
}

// getUrgencyLevel imported from message-templates

// generateEmailContent - using centralized template emailTemplates.emissionsReminder()

// generateSMSContent - using centralized template smsTemplates.emissionsReminder()

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<NotificationResult | { error: string }>
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('🚗 Starting emissions test reminder processing...');

  const results: NotificationResult = {
    success: true,
    processed: 0,
    notificationsSent: 0,
    errors: [],
  };

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get users with emissions dates set who HAVEN'T completed their test yet
    const { data: users, error } = await supabase
      .from('user_profiles')
      .select('*')
      .not('emissions_date', 'is', null)
      .or('emissions_completed.is.null,emissions_completed.eq.false');

    if (error) {
      throw error;
    }

    if (!users || users.length === 0) {
      console.log('No users with pending emissions tests found');
      return res.status(200).json(results);
    }

    console.log(`Found ${users.length} users with pending emissions tests`);

    for (const user of users) {
      results.processed++;

      const emissionsDate = new Date(user.emissions_date);
      emissionsDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.ceil((emissionsDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Skip if deadline already passed significantly
      if (daysUntil < -7) {
        console.log(`Skipping ${user.email}: emissions deadline passed ${Math.abs(daysUntil)} days ago`);
        continue;
      }

      // Get user's preferred reminder days from notify_days_array column
      // Fall back to sensible defaults (30, 7, 1 days) if not set
      const prefs = user.notification_preferences || {};
      const userReminderDays = user.notify_days_array && user.notify_days_array.length > 0
        ? user.notify_days_array
        : DEFAULT_REMINDER_DAYS;

      // Check if this falls on a reminder day (user's preferred days)
      // Also allow day 0 for overdue reminders if user has 0 or 1 in their days
      const isReminderDay = userReminderDays.includes(daysUntil) ||
        (daysUntil <= 0 && (userReminderDays.includes(0) || userReminderDays.includes(1)));

      if (!isReminderDay) {
        continue; // Not a reminder day for this user
      }

      console.log(`Processing ${user.email}: ${daysUntil} days until emissions deadline`);

      const messageKey = `emissions_reminder_${daysUntil}_${user.emissions_date}`;

      // Check if already sent
      if (await wasNotificationSent(user.user_id, messageKey)) {
        console.log(`Already sent ${daysUntil}-day reminder to ${user.email}`);
        continue;
      }

      // Generate and send notifications using centralized templates
      const effectiveDays = Math.max(0, daysUntil);
      const hasProtection = user.has_protection || false;

      const emailContent = emailTemplates.emissionsReminder(
        {
          firstName: user.first_name,
          licensePlate: user.license_plate,
          vehicleYear: user.vehicle_year,
          vehicleMake: user.vehicle_make,
          vehicleModel: user.vehicle_model,
        },
        effectiveDays,
        emissionsDate,
        hasProtection
      );
      const smsMessage = smsTemplates.emissionsReminder(effectiveDays, hasProtection, true);

      let sent = false;
      const phone = user.phone || user.phone_number;

      // Check user notification preferences
      const emailEnabled = prefs.email !== false && user.notify_email !== false; // Default to true if not set
      const smsEnabled = user.notify_sms || prefs.sms;
      const voiceEnabled = user.phone_call_enabled;

      // Send email if user has email AND email notifications enabled
      if (user.email && emailEnabled) {
        const emailSent = await sendEmail(user.email, emailContent.subject, emailContent.html);
        if (emailSent) {
          await logNotification(user.user_id, 'emissions_reminder', 'email', messageKey, daysUntil);
          sent = true;
        }
      }

      // Send SMS if user has phone and SMS enabled
      if (phone && smsEnabled) {
        const smsResult = await sendClickSendSMS(phone, smsMessage);
        const smsSent = smsResult.success;
        if (smsSent) {
          await logNotification(user.user_id, 'emissions_reminder', 'sms', messageKey + '_sms', daysUntil);
          sent = true;
        }
      }

      // ESCALATION: For critical deadlines (0-1 days), send SMS even if not normally enabled
      // Only for PAID (Protection) users
      if (daysUntil <= 1 && phone && !smsEnabled && hasProtection) {
        console.log(`🚨 ESCALATION: Sending emergency SMS for emissions test due in ${daysUntil} days (Protection user)`);
        const smsResult = await sendClickSendSMS(phone, smsMessage);
        const smsSent = smsResult.success;
        if (smsSent) {
          await logNotification(user.user_id, 'emissions_reminder_escalation', 'sms', messageKey + '_escalation', daysUntil);
          sent = true;
        }
      }

      // Send voice call if user has phone_call_enabled AND it's 7 days or less
      // Voice calls are only for urgent/critical timeframes - but still only on user's reminder days
      // (we already checked isReminderDay above, so this only fires on selected days)
      if (phone && voiceEnabled && daysUntil <= 7) {
        const voiceMessage = voiceTemplates.emissionsReminder(effectiveDays, hasProtection);
        console.log(`📞 Sending voice call for emissions test due in ${daysUntil} days`);
        const voiceResult = await sendClickSendVoiceCall(phone, voiceMessage);
        const voiceSent = voiceResult.success;
        if (voiceSent) {
          await logNotification(user.user_id, 'emissions_reminder', 'voice', messageKey + '_voice', daysUntil);
          sent = true;
        }
      }

      // ESCALATION: For critical deadlines (0-1 days), send voice call even if not normally enabled
      // Only for PAID (Protection) users
      if (daysUntil <= 1 && phone && !voiceEnabled && hasProtection) {
        const voiceMessage = voiceTemplates.emissionsReminder(effectiveDays, hasProtection);
        console.log(`🚨 ESCALATION: Sending emergency voice call for emissions test due in ${daysUntil} days (Protection user)`);
        const voiceResult = await sendClickSendVoiceCall(phone, voiceMessage);
        const voiceSent = voiceResult.success;
        if (voiceSent) {
          await logNotification(user.user_id, 'emissions_reminder_escalation', 'voice', messageKey + '_voice_escalation', daysUntil);
          sent = true;
        }
      }

      if (sent) {
        results.notificationsSent++;
        console.log(`✅ Sent ${daysUntil}-day emissions reminder to ${user.email}`);
      }
    }

    console.log('✅ Emissions test reminder processing complete');
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Notifications sent: ${results.notificationsSent}`);

    return res.status(200).json(results);

  } catch (error: any) {
    console.error('Error processing emissions reminders:', error);
    results.success = false;
    results.errors.push(error.message);
    return res.status(500).json(results);
  }
}
