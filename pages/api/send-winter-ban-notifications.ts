import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { sendClickSendSMS } from '../../lib/sms-service';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import { quickEmail, greeting as greet, p, callout, section, button, divider, bulletList, esc } from '../../lib/email-template';

const BRAND = {
  name: 'Autopilot America',
  dashboardUrl: 'https://autopilotamerica.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'Autopilot America <noreply@autopilotamerica.com>',
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

// SMS via centralized service with retry (lib/sms-service.ts)

function getNotificationYear(): number {
  const now = new Date();
  const month = now.getMonth();
  // Winter season starts Dec 1 (month 11), so if we're in Dec-Mar, use current year
  // If we're in Apr-Nov, we're before the next season, so use current year for upcoming season
  return now.getFullYear();
}

function getEmailHtml(firstName: string | null, streetName: string | null): string {
  const safeStreet = streetName ? esc(streetName) : null;
  const streetInfo = safeStreet
    ? `Our records show you park on <strong>${safeStreet}</strong>, which is subject to this ban.`
    : 'Our records indicate you may be affected by this ban.';

  return quickEmail({
    preheader: 'Winter overnight parking ban begins December 1 — move your car 3-7 AM nightly',
    headerTitle: 'Winter Parking Ban Starts Tomorrow',
    headerSubtitle: 'December 1 through April 1',
    body: [
      greet(firstName || undefined),
      p(`<strong>Chicago's Winter Overnight Parking Ban begins December 1st and runs through April 1st.</strong>`),
      p(streetInfo),
      callout('warning', 'Ban Details', bulletList([
        '<strong>When:</strong> 3:00 AM - 7:00 AM, every night',
        '<strong>Duration:</strong> December 1 - April 1',
        '<strong>Penalty:</strong> $150+ towing fee + $60 ticket + $25/day storage',
      ])),
      section('What To Do', bulletList([
        'Move your car off this street between 3 AM - 7 AM every night',
        'Or find alternative parking during these hours',
        'Look for permanent signage on your street',
      ])),
      divider(),
      p('This is a one-time reminder. The ban helps ensure emergency vehicles and plows can move freely during winter.', { size: '13px', color: '#6B7280' }),
    ].join(''),
  });
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
        .maybeSingle();

      if (existingNotification) {
        stats.alreadyNotified++;
        continue;
      }

      const channels: string[] = [];

      // Send SMS
      if (user.phone_number) {
        const smsResult = await sendClickSendSMS(user.phone_number, getSMSText(matchedStreet));
        if (smsResult.success) {
          channels.push('sms');
          stats.smsSent++;
        } else {
          console.error(`SMS failed for user ${user.user_id}:`, smsResult.error);
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
      error: sanitizeErrorMessage(error),
      stats
    });
  }
}
