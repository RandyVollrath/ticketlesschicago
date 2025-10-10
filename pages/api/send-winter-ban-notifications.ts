import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

const BRAND = {
  name: 'Ticketless America',
  dashboardUrl: 'https://ticketlessamerica.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'Ticketless America <noreply@ticketlessamerica.com>',
};

interface User {
  id: string;
  email: string;
  phone: string | null;
  first_name: string | null;
  home_address_full: string | null;
}

async function sendEmail(to: string, subject: string, html: string) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: BRAND.emailFrom,
      to: [to],
      subject,
      html
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Resend ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function sendSMS(to: string, body: string) {
  const response = await fetch('https://rest.clicksend.com/v3/sms/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(
        `${process.env.CLICKSEND_USERNAME}:${process.env.CLICKSEND_API_KEY}`
      ).toString('base64')
    },
    body: JSON.stringify({
      messages: [{
        source: 'node',
        from: process.env.SMS_SENDER,
        to,
        body,
        custom_string: 'winter-ban-notification'
      }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`ClickSend ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function getNotificationYear(): number {
  const now = new Date();
  const month = now.getMonth();
  // Winter season starts Dec 1 (month 11), so if we're in Dec-Mar, use current year
  // If we're in Apr-Nov, we're before the next season, so use current year for upcoming season
  return now.getFullYear();
}

function getEmailHtml(firstName: string | null, streetName: string | null): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
  const streetInfo = streetName
    ? `Our records show you park on ${streetName}, which is subject to this ban.`
    : 'Our records indicate you may be affected by this ban.';

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">❄️ Winter Overnight Parking Ban Starts Tomorrow</h2>
      <p>${greeting}</p>
      <p><strong>Chicago's Winter Overnight Parking Ban begins December 1st and runs through April 1st.</strong></p>
      <p>${streetInfo}</p>

      <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:20px 0">
        <strong>📍 Ban Details:</strong>
        <ul style="margin:8px 0">
          <li><strong>When:</strong> 3:00 AM - 7:00 AM, every night</li>
          <li><strong>Duration:</strong> December 1 - April 1</li>
          <li><strong>Penalty:</strong> $150+ towing fee + $60 ticket + $25/day storage</li>
        </ul>
      </div>

      <p><strong>What to do:</strong></p>
      <ul>
        <li>Move your car off this street between 3 AM - 7 AM every night</li>
        <li>Or find alternative parking during these hours</li>
        <li>Look for permanent signage on your street</li>
      </ul>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        This is a one-time reminder for the 2025-2026 winter season. The ban helps ensure emergency vehicles and plows can move freely during winter.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You're receiving this because you're registered with ${BRAND.name} at an address on a Winter Overnight Parking Ban street.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getSMSText(streetName: string | null): string {
  const location = streetName ? ` on ${streetName}` : '';
  return `❄️ WINTER PARKING BAN starts TOMORROW (Dec 1-Apr 1). NO parking${location} 3am-7am daily. Violation = $150+ tow + $60 ticket. Move your car! ${BRAND.dashboardUrl}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  const notificationYear = getNotificationYear();
  const stats = {
    usersChecked: 0,
    usersOnBanStreets: 0,
    emailsSent: 0,
    emailsFailed: 0,
    smsSent: 0,
    smsFailed: 0,
    alreadyNotified: 0
  };

  try {
    // Get all users who have addresses and notification preferences enabled
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone_number, first_name, home_address_full, notify_winter_ban')
      .eq('notify_winter_ban', true)
      .not('home_address_full', 'is', null);

    if (usersError) throw usersError;

    stats.usersChecked = users?.length || 0;

    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No users opted in for winter ban notifications',
        stats,
        processingTime: Date.now() - startTime
      });
    }

    // Get all winter ban streets
    const { data: banStreets, error: streetsError } = await supabaseAdmin
      .from('winter_overnight_parking_ban_streets')
      .select('street_name');

    if (streetsError) throw streetsError;

    const streetNames = (banStreets || []).map(s => s.street_name.toLowerCase());

    // Process each user
    for (const user of users) {
      if (!user.home_address_full) continue;

      // Check if user's address is on a winter ban street
      const address = user.home_address_full.toLowerCase();
      const matchedStreet = streetNames.find(street =>
        address.includes(street.toLowerCase())
      );

      if (!matchedStreet) continue;

      stats.usersOnBanStreets++;

      // Check if we've already notified this user for this season
      const { data: existingNotification } = await supabaseAdmin
        .from('user_winter_ban_notifications')
        .select('id')
        .eq('user_id', user.user_id)
        .eq('notification_year', notificationYear)
        .single();

      if (existingNotification) {
        stats.alreadyNotified++;
        continue;
      }

      const channels: string[] = [];

      // Send SMS
      if (user.phone_number) {
        try {
          await sendSMS(user.phone_number, getSMSText(matchedStreet));
          channels.push('sms');
          stats.smsSent++;
        } catch (error) {
          console.error(`SMS failed for user ${user.user_id}:`, error);
          stats.smsFailed++;
        }
      }

      // Send Email
      if (user.email) {
        try {
          await sendEmail(
            user.email,
            '❄️ Winter Overnight Parking Ban Starts Tomorrow (Dec 1)',
            getEmailHtml(user.first_name, matchedStreet)
          );
          channels.push('email');
          stats.emailsSent++;
        } catch (error) {
          console.error(`Email failed for user ${user.user_id}:`, error);
          stats.emailsFailed++;
        }
      }

      // Log the notification
      await supabaseAdmin
        .from('user_winter_ban_notifications')
        .insert({
          user_id: user.user_id,
          notification_year: notificationYear,
          notification_date: new Date().toISOString().split('T')[0],
          channels,
          status: 'sent'
        });
    }

    return res.status(200).json({
      success: true,
      stats,
      notificationYear,
      processingTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('Winter ban notification job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      stats
    });
  }
}
