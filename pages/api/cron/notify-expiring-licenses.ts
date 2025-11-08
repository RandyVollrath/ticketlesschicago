/**
 * Cron Job: Notify users with expiring driver's licenses
 *
 * Runs daily to find users whose driver's license will expire before their next
 * city sticker renewal. Sends email notification requesting updated license upload.
 *
 * Schedule: Daily at 3 AM CT
 * Trigger: 30 days before license expiration
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

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
    // Find users with licenses expiring in next 30 days
    // who have given multi-year reuse consent
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    const { data: expiringLicenses, error: queryError } = await supabase
      .from('user_profiles')
      .select('user_id, email, full_name, license_valid_until, city_sticker_expiry')
      .eq('license_reuse_consent_given', true)
      .not('license_valid_until', 'is', null)
      .lte('license_valid_until', thirtyDaysFromNow.toISOString().split('T')[0])
      .eq('has_protection', true);

    if (queryError) {
      console.error('Query error:', queryError);
      return res.status(500).json({ error: 'Database query failed' });
    }

    if (!expiringLicenses || expiringLicenses.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No expiring licenses found',
        count: 0,
      });
    }

    let notifiedCount = 0;
    const errors: any[] = [];

    for (const profile of expiringLicenses) {
      try {
        // Check if license expires before next city sticker renewal
        const licenseExpiry = new Date(profile.license_valid_until);
        const stickerExpiry = profile.city_sticker_expiry
          ? new Date(profile.city_sticker_expiry)
          : null;

        // If no sticker expiry set, still notify (they may need it soon)
        const needsUpdate =
          !stickerExpiry || licenseExpiry < stickerExpiry;

        if (!needsUpdate) {
          console.log(`User ${profile.user_id}: License expires after sticker, skipping`);
          continue;
        }

        // Send email notification
        const emailSent = await sendExpiringLicenseEmail(profile);

        if (emailSent) {
          // Mark as notified (could add a column for this if needed)
          console.log(`✓ Notified user ${profile.user_id} about expiring license`);
          notifiedCount++;
        }
      } catch (error: any) {
        console.error(`Error processing user ${profile.user_id}:`, error);
        errors.push({
          userId: profile.user_id,
          error: error.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Sent ${notifiedCount} license expiration notifications`,
      totalFound: expiringLicenses.length,
      notifiedCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error('Cron job error:', error);
    return res.status(500).json({
      error: 'Cron job failed',
      details: error.message,
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
Hi ${profile.full_name || 'there'},

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

    // Send email via your email service (Resend, SendGrid, etc.)
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: 'Ticketless Chicago <hello@ticketlesschicago.com>',
        to: profile.email,
        subject: emailSubject,
        text: emailBody,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Email send failed:', errorData);
      return false;
    }

    console.log(`✓ Email sent to ${profile.email}`);
    return true;
  } catch (error: any) {
    console.error('Email send error:', error);
    return false;
  }
}
