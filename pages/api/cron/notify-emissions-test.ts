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

// Reminder schedule in days before emissions deadline
const REMINDER_DAYS = [90, 60, 45, 30, 14, 7, 3, 1, 0];

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

/**
 * Get urgency level for messaging
 */
function getUrgencyLevel(daysUntil: number): 'critical' | 'urgent' | 'important' | 'reminder' {
  if (daysUntil <= 1) return 'critical';
  if (daysUntil <= 7) return 'urgent';
  if (daysUntil <= 30) return 'important';
  return 'reminder';
}

/**
 * Generate email content based on urgency
 */
function generateEmailContent(user: any, daysUntil: number, emissionsDate: Date): { subject: string; html: string } {
  const urgency = getUrgencyLevel(daysUntil);
  const dateStr = emissionsDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const urgencyStyles: Record<string, { bg: string; border: string; text: string; emoji: string }> = {
    critical: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b', emoji: '🚨' },
    urgent: { bg: '#fef3c7', border: '#f59e0b', text: '#92400e', emoji: '⚠️' },
    important: { bg: '#eff6ff', border: '#3b82f6', text: '#1e40af', emoji: '📋' },
    reminder: { bg: '#f0fdf4', border: '#10b981', text: '#065f46', emoji: '🔔' },
  };

  const style = urgencyStyles[urgency];
  const timeText = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `in ${daysUntil} days`;

  let subject: string;
  let headerText: string;
  let bodyText: string;

  switch (urgency) {
    case 'critical':
      subject = `${style.emoji} URGENT: Emissions Test Due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}`;
      headerText = `Your Emissions Test is Due ${daysUntil === 0 ? 'TODAY' : 'TOMORROW'}!`;
      bodyText = `This is your final reminder. Without a valid emissions test, you cannot renew your license plate. Please complete your test immediately.`;
      break;
    case 'urgent':
      subject = `${style.emoji} Emissions Test Due in ${daysUntil} Days - Action Required`;
      headerText = `Emissions Test Due in ${daysUntil} Days`;
      bodyText = `Your emissions test deadline is approaching quickly. Schedule your test now to avoid delays with your license plate renewal.`;
      break;
    case 'important':
      subject = `${style.emoji} Emissions Test Reminder - ${daysUntil} Days Left`;
      headerText = `Emissions Test Due in ${daysUntil} Days`;
      bodyText = `Don't forget - you need to complete your emissions test before you can renew your license plate. Schedule it soon to avoid the last-minute rush.`;
      break;
    default:
      subject = `${style.emoji} Emissions Test Coming Up - ${daysUntil} Days`;
      headerText = `Emissions Test Due in ${daysUntil} Days`;
      bodyText = `This is a friendly reminder that your emissions test is coming up. You have time, but it's good to plan ahead!`;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: ${style.bg}; border-left: 4px solid ${style.border}; padding: 24px; border-radius: 4px;">
        <h1 style="margin: 0 0 16px; color: ${style.text}; font-size: 24px;">${headerText}</h1>
        <p style="margin: 0; color: ${style.text}; font-size: 16px;">${bodyText}</p>
      </div>

      <div style="padding: 24px; background: #ffffff;">
        <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
          <div style="margin-bottom: 8px;">
            <strong>Vehicle:</strong> ${user.vehicle_year || ''} ${user.vehicle_make || ''} ${user.vehicle_model || ''} (${user.license_plate})
          </div>
          <div>
            <strong>Emissions Test Deadline:</strong> ${dateStr}
          </div>
        </div>

        <h3 style="color: #374151; margin-bottom: 12px;">How to Get Your Emissions Test:</h3>
        <ol style="color: #4b5563; line-height: 1.8; padding-left: 20px;">
          <li>Find a testing location at <a href="https://airteam.app/forms/locator.cfm" style="color: #2563eb;">airteam.app</a></li>
          <li>Bring your vehicle registration</li>
          <li>Bring $20 cash (test fee)</li>
          <li>The test takes about 10-15 minutes</li>
        </ol>

        ${user.has_protection ? `
          <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 16px; margin-top: 20px;">
            <h3 style="margin: 0 0 8px; color: #1e40af;">Why This Matters for Your Protection Plan:</h3>
            <p style="margin: 0; color: #1e40af;">
              We handle your license plate renewal automatically, but Illinois requires a valid emissions test first.
              Once you complete your test, we'll process your renewal!
            </p>
          </div>
        ` : ''}

        <div style="margin-top: 24px; text-align: center;">
          <a href="https://airteam.app/forms/locator.cfm"
             style="background: #2563eb; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">
            Find Testing Locations
          </a>
        </div>

        <p style="color: #6b7280; font-size: 14px; margin-top: 24px; text-align: center;">
          Questions? Reply to this email or contact support@autopilotamerica.com
        </p>
      </div>
    </div>
  `;

  return { subject, html };
}

/**
 * Generate SMS content based on urgency
 */
function generateSMSContent(user: any, daysUntil: number): string {
  const timeText = daysUntil === 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `in ${daysUntil} days`;

  if (daysUntil <= 1) {
    return `🚨 URGENT: Emissions test for ${user.license_plate} is due ${timeText}! Without it, you can't renew your plate. Find a location: airteam.app - Autopilot America`;
  } else if (daysUntil <= 7) {
    return `⚠️ Emissions test for ${user.license_plate} due ${timeText}. Schedule now: airteam.app. Required for plate renewal. - Autopilot America`;
  } else if (daysUntil <= 30) {
    return `📋 Reminder: Emissions test for ${user.license_plate} due ${timeText}. Plan ahead: airteam.app - Autopilot America`;
  } else {
    return `🔔 FYI: Emissions test for ${user.license_plate} due ${timeText}. Find locations: airteam.app - Autopilot America`;
  }
}

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

    // Get users with emissions dates set who haven't completed the test
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

      // Check if this falls on a reminder day
      const reminderDay = REMINDER_DAYS.find(d => d === daysUntil || (daysUntil < 0 && d === 0));

      if (reminderDay === undefined) {
        continue; // Not a reminder day
      }

      console.log(`Processing ${user.email}: ${daysUntil} days until emissions deadline`);

      const messageKey = `emissions_reminder_${daysUntil}_${user.emissions_date}`;

      // Check if already sent
      if (await wasNotificationSent(user.user_id, messageKey)) {
        console.log(`Already sent ${daysUntil}-day reminder to ${user.email}`);
        continue;
      }

      // Generate and send notifications
      const { subject, html } = generateEmailContent(user, Math.max(0, daysUntil), emissionsDate);
      const smsMessage = generateSMSContent(user, Math.max(0, daysUntil));

      let sent = false;

      // Send email if user has email
      if (user.email) {
        const emailSent = await sendEmail(user.email, subject, html);
        if (emailSent) {
          await logNotification(user.user_id, 'emissions_reminder', 'email', messageKey, daysUntil);
          sent = true;
        }
      }

      // Send SMS if user has phone and SMS enabled
      const phone = user.phone || user.phone_number;
      if (phone && user.notify_sms) {
        const smsSent = await sendSMS(phone, smsMessage);
        if (smsSent) {
          await logNotification(user.user_id, 'emissions_reminder', 'sms', messageKey + '_sms', daysUntil);
          sent = true;
        }
      }

      // For critical deadlines (0-1 days), send SMS even if not normally enabled
      if (daysUntil <= 1 && phone && !user.notify_sms) {
        console.log(`🚨 ESCALATION: Sending emergency SMS for emissions test due in ${daysUntil} days`);
        const smsSent = await sendSMS(phone, smsMessage);
        if (smsSent) {
          await logNotification(user.user_id, 'emissions_reminder_escalation', 'sms', messageKey + '_escalation', daysUntil);
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
