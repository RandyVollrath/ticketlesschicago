/**
 * Cron Job: Notify users with expiring driver's licenses
 *
 * Runs daily to find users whose driver's license will expire before their next
 * city sticker renewal. Only notifies if license expires 60+ days before sticker
 * renewal to give user enough time to get new license and upload it.
 *
 * Schedule: Daily at 3 AM CT
 * Trigger: 60+ days before city sticker renewal
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { notificationLogger } from '../../../lib/notification-logger';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Find users with city sticker renewals in next 90 days
    // whose license expires before renewal
    const ninetyDaysFromNow = new Date();
    ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

    const { data: profiles, error: queryError } = await supabase
      .from('user_profiles')
      .select('user_id, email, first_name, license_valid_until, city_sticker_expiry, phone, phone_number, notify_sms, notify_email')
      .eq('license_reuse_consent_given', true)
      .not('license_valid_until', 'is', null)
      .not('city_sticker_expiry', 'is', null)
      .eq('has_contesting', true)
      .lte('city_sticker_expiry', ninetyDaysFromNow.toISOString().split('T')[0]);

    if (queryError) {
      console.error('Query error:', queryError);
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (!profiles || profiles.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No upcoming renewals with expiring licenses',
        count: 0,
      });
    }

    let notifiedCount = 0;
    const errors: any[] = [];

    for (const profile of profiles) {
      try {
        const licenseExpiry = new Date(profile.license_valid_until);
        const stickerExpiry = new Date(profile.city_sticker_expiry);
        const renewalDate = new Date(stickerExpiry.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days before sticker expiry

        // Check if license expires before renewal date
        if (licenseExpiry >= renewalDate) {
          console.log(`User ${profile.user_id}: License valid until renewal, skipping`);
          continue;
        }

        // Check if we have at least 60 days until renewal (gives user time to get new license)
        const daysUntilRenewal = Math.ceil((renewalDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

        if (daysUntilRenewal < 60) {
          console.log(`User ${profile.user_id}: Only ${daysUntilRenewal} days until renewal, too late to notify`);
          continue;
        }

        console.log(`User ${profile.user_id}: License expires before renewal (${daysUntilRenewal} days out), notifying...`);

        // Send email notification (primary channel)
        const emailSent = profile.notify_email !== false
          ? await sendExpiringLicenseEmail(profile)
          : false;

        // Send SMS backup so a spam-foldered email doesn't blow a renewal
        // deadline. Gated on explicit notify_sms consent + phone on file.
        const phone = profile.phone_number || profile.phone;
        const smsSent = (profile.notify_sms && phone)
          ? await sendExpiringLicenseSMS(profile, phone)
          : false;

        if (emailSent || smsSent) {
          console.log(`✓ Notified user ${profile.user_id} about expiring license (email=${emailSent}, sms=${smsSent})`);
          notifiedCount++;
        }
      } catch (error: any) {
        console.error(`Error processing user ${profile.user_id}:`, error);
        errors.push({
          userId: profile.user_id,
          error: sanitizeErrorMessage(error),
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Sent ${notifiedCount} license expiration notifications`,
      totalFound: profiles.length,
      notifiedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      error: 'Cron job failed',
    });
  }
}

/**
 * Send email notification to user about expiring license
 */
async function sendExpiringLicenseEmail(profile: any): Promise<boolean> {
  try {
    const licenseExpiry = new Date(profile.license_valid_until);
    const formattedDate = licenseExpiry.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    const daysUntilExpiry = Math.ceil(
      (licenseExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    );

    // Calculate next city sticker renewal date (30 days before expiry)
    const stickerExpiry = profile.city_sticker_expiry
      ? new Date(profile.city_sticker_expiry)
      : null;
    const nextRenewal = stickerExpiry
      ? new Date(stickerExpiry.getTime() - 30 * 24 * 60 * 60 * 1000)
      : null;

    const emailSubject = '🚨 Update Your Driver\'s License - City Sticker Renewal';

    const emailBody = `
Hi ${profile.first_name || 'there'},

Your driver's license expires ${daysUntilExpiry > 0 ? `in ${daysUntilExpiry} days` : 'soon'} (${formattedDate})${
      nextRenewal
        ? `, before your next city sticker renewal on ${nextRenewal.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
        : ''
    }.

To continue your automated city sticker renewals, we need an updated driver's license image.

📸 Upload Your Updated License:
https://ticketlesschicago.com/settings#license-upload

Why we need this:
✓ The city requires a valid driver's license for permit parking city stickers
✓ We can only renew if your license is current and matches your vehicle registration
${
  nextRenewal
    ? `✓ Without an updated license, we can't process your ${nextRenewal.getFullYear()} renewal`
    : ''
}

This will only take 2 minutes:
1. Visit your settings page
2. Click "Upload Driver's License"
3. Take a clear photo of your new license
4. Done! We'll handle your renewals for the next ${licenseExpiry.getFullYear() - new Date().getFullYear() + 1} years

Questions? Reply to this email or visit https://ticketlesschicago.com/help

Thanks for using Ticketless Chicago!

—
Ticketless Chicago
Automated parking ticket contesting and city sticker renewals
    `.trim();

    // Log the attempt BEFORE the HTTP call so a crash mid-send is still
    // visible to the QA report.
    const logId = await notificationLogger.log({
      user_id: profile.user_id,
      email: profile.email,
      notification_type: 'email',
      category: 'license_expiring',
      subject: emailSubject,
      content_preview: emailBody.slice(0, 200),
      status: 'pending',
    });

    // Send email via your email service (Resend, SendGrid, etc.)
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Autopilot America <hello@autopilotamerica.com>',
        to: profile.email,
        subject: emailSubject,
        text: emailBody,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Email send failed:', errorData);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, JSON.stringify(errorData).slice(0, 500));
      return false;
    }

    const data = await response.json().catch(() => ({}));
    if (logId) await notificationLogger.updateStatus(logId, 'sent', data.id);
    console.log(`✓ Email sent to ${profile.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}

/**
 * SMS fallback for users who opted in. Shorter copy than the email.
 */
async function sendExpiringLicenseSMS(profile: any, phone: string): Promise<boolean> {
  try {
    const expiry = new Date(profile.license_valid_until);
    const days = Math.max(0, Math.ceil((expiry.getTime() - Date.now()) / 86400000));
    const message =
      `Autopilot America: your driver's license expires ${days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : 'soon'}. ` +
      `Upload an updated photo at autopilotamerica.com/settings so we can keep your city-sticker renewal on autopilot. ` +
      `Reply STOP to unsubscribe.`;

    const logId = await notificationLogger.log({
      user_id: profile.user_id,
      phone,
      notification_type: 'sms',
      category: 'license_expiring',
      content_preview: message.slice(0, 200),
      status: 'pending',
    });

    const result = await sendClickSendSMS(phone, message);
    if (!result.success) {
      console.error('SMS send failed:', result.error);
      if (logId) await notificationLogger.updateStatus(logId, 'failed', undefined, result.error);
      return false;
    }
    if (logId) await notificationLogger.updateStatus(logId, 'sent', result.messageId);
    console.log(`✓ SMS sent to ${phone}`);
    return true;
  } catch (error: any) {
    console.error('SMS send error:', error);
    return false;
  }
}
