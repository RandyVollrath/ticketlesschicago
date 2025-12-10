import { supabaseAdmin } from './supabase';
import { sendClickSendSMS } from './sms-service';

const BRAND = {
  name: 'Autopilot America',
  dashboardUrl: 'https://autopilotamerica.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'Autopilot America <noreply@autopilotamerica.com>',
};

/**
 * Check if current date is during winter ban season (Dec 1 - Apr 1)
 */
export function isWinterBanSeason(): boolean {
  const now = new Date();
  const month = now.getMonth(); // 0-11
  const day = now.getDate();

  // December (month 11), January (0), February (1), March (2)
  // Or April 1st (month 3, day 1)
  return (
    month === 11 || // December
    month === 0 ||  // January
    month === 1 ||  // February
    month === 2 ||  // March
    (month === 3 && day === 1) // April 1st only
  );
}

/**
 * Get the current winter season year
 */
export function getWinterSeasonYear(): number {
  const now = new Date();
  return now.getFullYear();
}

/**
 * Check if an address is on a winter overnight parking ban street
 */
export async function isAddressOnWinterBanStreet(address: string): Promise<{
  isOnBanStreet: boolean;
  matchedStreet: string | null;
}> {
  if (!address) {
    return { isOnBanStreet: false, matchedStreet: null };
  }

  const { data: banStreets } = await supabaseAdmin
    .from('winter_overnight_parking_ban_streets')
    .select('street_name');

  if (!banStreets || banStreets.length === 0) {
    return { isOnBanStreet: false, matchedStreet: null };
  }

  const addressLower = address.toLowerCase();
  const matchedStreet = banStreets.find(s =>
    addressLower.includes(s.street_name.toLowerCase())
  );

  return {
    isOnBanStreet: !!matchedStreet,
    matchedStreet: matchedStreet?.street_name || null
  };
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

function getEmailHtml(firstName: string | null, streetName: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">❄️ Important: Winter Overnight Parking Ban</h2>
      <p>${greeting}</p>
      <p>Welcome to ${BRAND.name}! We noticed you're registered at an address on <strong>${streetName}</strong>, which is subject to Chicago's Winter Overnight Parking Ban.</p>

      <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:20px 0">
        <strong>📍 Active Ban Details:</strong>
        <ul style="margin:8px 0">
          <li><strong>When:</strong> 3:00 AM - 7:00 AM, every night</li>
          <li><strong>Duration:</strong> December 1 - April 1</li>
          <li><strong>Penalty:</strong> $150+ towing fee + $60 ticket + $25/day storage</li>
        </ul>
      </div>

      <p><strong>⚠️ This ban is currently in effect!</strong></p>
      <p>You must move your car off ${streetName} between 3 AM - 7 AM every night to avoid being towed.</p>

      <p><strong>Why this ban exists:</strong> The Winter Overnight Parking Ban ensures emergency vehicles and snowplows can move freely during winter months.</p>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        Look for permanent signage posted on your street for official notification.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You're receiving this because you registered with ${BRAND.name} at an address on a Winter Overnight Parking Ban street.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getSMSText(streetName: string): string {
  return `❄️ IMPORTANT: ${streetName} has ACTIVE Winter Parking Ban (Dec 1-Apr 1). NO parking 3am-7am daily. Violation = $150+ tow + $60 ticket. Move your car nightly! ${BRAND.dashboardUrl}`;
}

/**
 * Send winter ban notification to a new user who signed up during winter season
 * Call this when a user signs up or updates their address during Dec 1 - Apr 1
 */
export async function notifyNewUserAboutWinterBan(
  userId: string,
  address: string,
  email: string | null,
  phone: string | null,
  firstName: string | null = null
): Promise<{
  sent: boolean;
  reason?: string;
}> {
  // Check if it's winter season
  if (!isWinterBanSeason()) {
    return { sent: false, reason: 'Not winter season' };
  }

  // Check if address is on a ban street
  const { isOnBanStreet, matchedStreet } = await isAddressOnWinterBanStreet(address);
  if (!isOnBanStreet || !matchedStreet) {
    return { sent: false, reason: 'Address not on winter ban street' };
  }

  // Check if user was already notified this season
  const notificationYear = getWinterSeasonYear();
  const { data: existingNotification } = await supabaseAdmin
    .from('user_winter_ban_notifications')
    .select('id')
    .eq('user_id', userId)
    .eq('notification_year', notificationYear)
    .single();

  if (existingNotification) {
    return { sent: false, reason: 'Already notified this season' };
  }

  const channels: string[] = [];

  // Send SMS
  if (phone) {
    const smsResult = await sendClickSendSMS(phone, getSMSText(matchedStreet));
    if (smsResult.success) {
      channels.push('sms');
    } else {
      console.error(`Winter ban SMS failed for user ${userId}:`, smsResult.error);
    }
  }

  // Send Email
  if (email) {
    try {
      await sendEmail(
        email,
        '❄️ Important: Winter Overnight Parking Ban (Active Now)',
        getEmailHtml(firstName, matchedStreet)
      );
      channels.push('email');
    } catch (error) {
      console.error(`Winter ban email failed for user ${userId}:`, error);
    }
  }

  // Log the notification
  if (channels.length > 0) {
    await supabaseAdmin
      .from('user_winter_ban_notifications')
      .insert({
        user_id: userId,
        notification_year: notificationYear,
        notification_date: new Date().toISOString().split('T')[0],
        channels,
        status: 'sent'
      });

    return { sent: true };
  }

  return { sent: false, reason: 'No contact methods available' };
}
