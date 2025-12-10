import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { getUsersOnSnowRoutes } from '../../lib/snow-route-matcher';
import { sendClickSendSMS } from '../../lib/sms-service';

const BRAND = {
  name: 'Autopilot America',
  dashboardUrl: 'https://ticketlessamerica.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'Autopilot America <noreply@ticketlessamerica.com>',
};

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

function getForecastEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string, userAddress: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">❄️ 2+ Inches of Snow Forecasted for Your Street</h2>
      <p>${greeting}</p>
      <p><strong>Chicago is forecasted to receive ${snowAmount}" of snow, which may trigger the 2-inch parking ban on your street.</strong></p>

      <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:20px 0">
        <strong>⚠️ PREPARE TO MOVE YOUR CAR</strong>
        <ul style="margin:8px 0">
          <li><strong>Your Street:</strong> ${streetInfo}</li>
          <li><strong>Forecasted Snow:</strong> ${snowAmount} inches</li>
          <li><strong>When Ban Activates:</strong> Once 2+ inches has actually fallen (not yet in effect)</li>
          <li><strong>Penalty if Violated:</strong> $150 towing + $60 ticket + $25/day storage = <strong>$235+ total</strong></li>
        </ul>
      </div>

      <div style="text-align:center;margin:24px 0">
        <a href="${safeParkingUrl}" style="display:inline-block;background:#ec4899;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">
          🅿️ Find Safe Parking Near You
        </a>
        <p style="font-size:13px;color:#6b7280;margin-top:8px">See which streets near you are NOT affected by the snow ban</p>
      </div>

      <p><strong>📋 Two-Inch Snow Ban Rules:</strong></p>
      <ul>
        <li>Applies to 500 miles of main streets in Chicago</li>
        <li>Activates when 2+ inches of snow has actually fallen (any time, any day)</li>
        <li>Remains in effect until snow removal is complete (24-48 hours typically)</li>
        <li>Cars parked on affected streets may be ticketed and relocated</li>
      </ul>

      <p><strong>🚗 What to do:</strong></p>
      <ol>
        <li>Monitor weather conditions closely</li>
        <li>Be prepared to move your car off ${streetInfo}</li>
        <li><strong>We'll send you a confirmation alert when 2+ inches has actually fallen</strong></li>
        <li>When confirmed, move to a side street (not a main arterial)</li>
      </ol>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        <strong>Important:</strong> The 2-inch snow ban is not yet in effect. This is a forecast alert to help you prepare. We will notify you again when the snow has actually fallen and the ban becomes active.
      </p>

      <p style="font-size:14px;color:#6b7280;">
        <strong>Official info:</strong> <a href="https://www.chicago.gov/city/en/depts/streets/provdrs/traffic/svcs/winter-snow-parking-restrictions.html">Chicago.gov Winter Parking</a>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You're receiving this because you're registered with ${BRAND.name} at an address on a 2-inch snow ban street.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getConfirmationEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string, userAddress: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">🚨 2+ Inches of Snow Has Fallen - Ban May Be Active</h2>
      <p>${greeting}</p>
      <p><strong>Chicago has received ${snowAmount}" of snow. The city may activate the 2-inch parking ban on ${streetInfo} at any time.</strong></p>

      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;margin:20px 0">
        <strong>⚠️ MOVE YOUR CAR TO BE SAFE</strong>
        <ul style="margin:8px 0">
          <li><strong>Snow Threshold Met:</strong> ${snowAmount}" has fallen (2"+ triggers eligibility)</li>
          <li><strong>Ban Status:</strong> May be activated by the city at any time</li>
          <li><strong>Your Street:</strong> ${streetInfo}</li>
          <li><strong>Penalty if Enforced:</strong> $150 towing + $60 ticket + $25/day storage = <strong>$235+ total</strong></li>
        </ul>
      </div>

      <div style="text-align:center;margin:24px 0">
        <a href="${safeParkingUrl}" style="display:inline-block;background:#ec4899;color:white;padding:14px 28px;text-decoration:none;border-radius:8px;font-weight:600;font-size:16px">
          🅿️ Find Safe Parking Near You
        </a>
        <p style="font-size:13px;color:#6b7280;margin-top:8px">See which streets near you are NOT affected by the snow ban</p>
      </div>

      <p><strong>🚗 Recommended Steps:</strong></p>
      <ol>
        <li>Move your car off ${streetInfo} to be safe</li>
        <li>Park on a side street (not a main arterial street)</li>
        <li>Monitor @ChicagoDOT on X/Twitter for official ban activation announcements</li>
      </ol>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        <strong>Note:</strong> The city decides when to activate the ban based on conditions - it's not automatic. However, once 2+ inches has fallen, the ban can be activated at any time without additional notice. Moving your car now is the safest option.
      </p>

      <p style="font-size:14px;color:#6b7280;">
        <strong>Official info:</strong> <a href="https://www.chicago.gov/city/en/depts/streets/provdrs/traffic/svcs/winter-snow-parking-restrictions.html">Chicago.gov Winter Parking</a>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You're receiving this because you're registered with ${BRAND.name} at an address on a 2-inch snow ban street.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getForecastSMSText(snowAmount: number, streetInfo: string, userAddress: string): string {
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;
  return `❄️ ${snowAmount}" snow forecasted. 2-inch parking ban may activate on ${streetInfo}. Find safe parking: ${safeParkingUrl}`;
}

function getConfirmationSMSText(snowAmount: number, streetInfo: string, userAddress: string): string {
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;
  return `🚨 ${snowAmount}" snow has fallen. 2-inch ban MAY BE ACTIVE on ${streetInfo}. Move your car to be safe! Find parking: ${safeParkingUrl}`;
}

// Templates for users NOT on snow routes (awareness alerts)
function getAwarenessForecastEmailHtml(firstName: string | null, snowAmount: number): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">❄️ 2-Inch Snow Ban May Be Activated Soon</h2>
      <p>${greeting}</p>
      <p><strong>Chicago is forecasted to receive ${snowAmount}" of snow, which may trigger the 2-inch parking ban on main streets.</strong></p>

      <div style="background:#dbeafe;border-left:4px solid #3b82f6;padding:16px;margin:20px 0">
        <strong>ℹ️ FOR YOUR AWARENESS</strong>
        <p style="margin:8px 0 0">Your registered address is <strong>not</strong> on a 2-inch snow ban route. However, if you park on any main arterial streets in Chicago, you should be prepared to move your car.</p>
      </div>

      <p><strong>📋 Two-Inch Snow Ban Rules:</strong></p>
      <ul>
        <li>Applies to 500 miles of main streets in Chicago</li>
        <li>Activates when 2+ inches of snow has actually fallen</li>
        <li>Cars parked on affected streets may be ticketed ($60) and towed ($150+)</li>
        <li>Look for "2-inch snow" parking signs on streets you use</li>
      </ul>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        <strong>Tip:</strong> Read street parking signs carefully before leaving your car, especially on major streets during winter.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You requested snow ban awareness alerts from ${BRAND.name}.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getAwarenessConfirmationEmailHtml(firstName: string | null, snowAmount: number): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';
  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">🚨 2+ Inches of Snow Has Fallen - Ban May Be Active</h2>
      <p>${greeting}</p>
      <p><strong>Chicago has received ${snowAmount}" of snow. The city may activate the 2-inch parking ban on main arterial streets at any time.</strong></p>

      <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;margin:20px 0">
        <strong>⚠️ CHECK WHERE YOU'RE PARKED</strong>
        <p style="margin:8px 0 0">Your registered address is <strong>not</strong> on a 2-inch snow ban route. However, if you've parked on any main arterial street, you should consider moving your car to avoid a potential $60 ticket and $150+ towing fee.</p>
      </div>

      <p><strong>🚗 What to check:</strong></p>
      <ul>
        <li>Look at the parking signs where your car is currently parked</li>
        <li>If you see "2-inch snow" restrictions, consider moving your car</li>
        <li>Park on side streets (not main arterials) to be safe</li>
        <li>Monitor @ChicagoDOT on X/Twitter for official ban announcements</li>
      </ul>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        <strong>Note:</strong> The city decides when to activate the ban - it's not automatic when 2" falls. However, once activated, the ban typically lasts 24-48 hours until snow removal is complete.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You requested snow ban awareness alerts from ${BRAND.name}.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getAwarenessForecastSMSText(snowAmount: number): string {
  return `❄️ ${snowAmount}" snow forecasted in Chicago. 2-inch parking ban may activate on main streets. Check signs if parked on arterials. -Autopilot America`;
}

function getAwarenessConfirmationSMSText(snowAmount: number): string {
  return `🚨 ${snowAmount}" snow fell in Chicago. 2-inch ban MAY BE ACTIVE. If parked on a main street, check signs & consider moving. -Autopilot America`;
}

// Exportable function for direct calls (from cron jobs)
export async function sendSnowBanNotifications(notificationType: 'forecast' | 'confirmation' = 'confirmation') {
  const stats = {
    usersChecked: 0,
    usersNotified: 0,
    emailsSent: 0,
    emailsFailed: 0,
    smsSent: 0,
    smsFailed: 0,
    alreadyNotified: 0,
    noActiveEvent: 0,
    notOnSnowRoute: 0
  };

  // Get the most recent active snow event that hasn't been fully notified
  const { data: snowEvent } = await supabaseAdmin
    .from('snow_events')
    .select('*')
    .eq('is_active', true)
    .gte('snow_amount_inches', 2.0)
    .order('event_date', { ascending: false })
    .limit(1)
    .single();

  if (!snowEvent) {
    return {
      success: true,
      message: 'No active 2-inch snow event to notify about',
      stats
    };
  }

  const isForecastNotif = notificationType === 'forecast';

  // Get users on snow routes (filters by home_address_full matching snow_routes table)
  const usersOnSnowRoutes = await getUsersOnSnowRoutes();
  const snowRouteUserIds = new Set(usersOnSnowRoutes.map(u => u.user_id));

  // Filter snow route users based on their notification preferences
  const snowRouteUsersToNotify = usersOnSnowRoutes.filter(user => {
    return isForecastNotif ? user.notify_snow_forecast === true : user.notify_snow_confirmation === true;
  });

  // Also get ALL users who opted in (for awareness alerts to those NOT on snow routes)
  const { data: allOptedInUsers } = await supabaseAdmin
    .from('user_profiles')
    .select(`
      user_id,
      email,
      phone_number,
      first_name,
      notify_snow_forecast,
      notify_snow_forecast_email,
      notify_snow_forecast_sms,
      notify_snow_confirmation,
      notify_snow_confirmation_email,
      notify_snow_confirmation_sms,
      on_snow_route
    `)
    .eq(isForecastNotif ? 'notify_snow_forecast' : 'notify_snow_confirmation', true);

  // Filter to only users NOT on snow routes (awareness alerts)
  const awarenessUsers = (allOptedInUsers || []).filter(user => !snowRouteUserIds.has(user.user_id));

  const totalUsersToNotify = snowRouteUsersToNotify.length + awarenessUsers.length;
  stats.usersChecked = totalUsersToNotify;

  if (totalUsersToNotify === 0) {
    return {
      success: true,
      message: `No users opted in for ${notificationType} notifications`,
      stats,
      snowEvent
    };
  }

  // Helper function to send notification and log it
  async function sendAndLogNotification(
    userId: string,
    email: string | null,
    phoneNumber: string | null,
    firstName: string | null,
    emailSubject: string,
    emailHtml: string,
    smsText: string,
    smsEnabled: boolean,
    emailEnabled: boolean
  ) {
    // Check if user has already been notified for this snow event and notification type
    const { data: existingNotification } = await supabaseAdmin
      .from('user_snow_ban_notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('snow_event_id', snowEvent.id)
      .eq('notification_type', notificationType)
      .single();

    if (existingNotification) {
      stats.alreadyNotified++;
      return;
    }

    const channels: string[] = [];

    // Send SMS (if enabled and user has phone number)
    if (smsEnabled && phoneNumber) {
      const smsResult = await sendClickSendSMS(phoneNumber, smsText);
      if (smsResult.success) {
        channels.push('sms');
        stats.smsSent++;
      } else {
        console.error(`SMS failed for user ${userId}:`, smsResult.error);
        stats.smsFailed++;
      }
    }

    // Send Email (if enabled and user has email)
    if (emailEnabled && email) {
      try {
        await sendEmail(email, emailSubject, emailHtml);
        channels.push('email');
        stats.emailsSent++;
      } catch (error) {
        console.error(`Email failed for user ${userId}:`, error);
        stats.emailsFailed++;
      }
    }

    // Log the notification
    if (channels.length > 0) {
      const { error: insertError } = await supabaseAdmin
        .from('user_snow_ban_notifications')
        .insert({
          user_id: userId,
          snow_event_id: snowEvent.id,
          notification_date: new Date().toISOString().split('T')[0],
          notification_type: notificationType,
          channels,
          status: 'sent'
        });

      if (insertError) {
        console.error(`Failed to log notification for user ${userId}:`, insertError);
      }

      stats.usersNotified++;
    }
  }

  // Batch size for parallel processing (avoid overwhelming APIs)
  const BATCH_SIZE = 50;

  // Helper to process notifications in parallel batches
  async function processBatch<T>(
    items: T[],
    processor: (item: T) => Promise<void>
  ) {
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(processor));
    }
  }

  // Process users ON snow routes (urgent alerts with their specific street) - PARALLEL
  await processBatch(snowRouteUsersToNotify, async (user) => {
    const streetInfo = user.route.on_street;
    const userAddress = user.home_address_full || user.route.on_street;

    const emailSubject = isForecastNotif
      ? `❄️ ${snowEvent.snow_amount_inches}" Snow Forecasted - 2-Inch Ban May Apply`
      : `🚨 ${snowEvent.snow_amount_inches}" Snow Fell - 2-Inch Ban May Be Active`;
    const emailHtml = isForecastNotif
      ? getForecastEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo, userAddress)
      : getConfirmationEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo, userAddress);
    const smsText = isForecastNotif
      ? getForecastSMSText(snowEvent.snow_amount_inches, streetInfo, userAddress)
      : getConfirmationSMSText(snowEvent.snow_amount_inches, streetInfo, userAddress);

    const smsEnabled = isForecastNotif
      ? user.notify_snow_forecast_sms !== false
      : user.notify_snow_confirmation_sms !== false;
    const emailEnabled = isForecastNotif
      ? user.notify_snow_forecast_email !== false
      : user.notify_snow_confirmation_email !== false;

    await sendAndLogNotification(
      user.user_id,
      user.email,
      user.phone_number,
      user.first_name,
      emailSubject,
      emailHtml,
      smsText,
      smsEnabled,
      emailEnabled
    );
  });

  // Process users NOT on snow routes (awareness alerts) - PARALLEL
  await processBatch(awarenessUsers, async (user) => {
    const emailSubject = isForecastNotif
      ? `❄️ ${snowEvent.snow_amount_inches}" Snow Forecasted - 2-Inch Ban Alert`
      : `🚨 ${snowEvent.snow_amount_inches}" Snow Fell - 2-Inch Ban May Be Active`;
    const emailHtml = isForecastNotif
      ? getAwarenessForecastEmailHtml(user.first_name, snowEvent.snow_amount_inches)
      : getAwarenessConfirmationEmailHtml(user.first_name, snowEvent.snow_amount_inches);
    const smsText = isForecastNotif
      ? getAwarenessForecastSMSText(snowEvent.snow_amount_inches)
      : getAwarenessConfirmationSMSText(snowEvent.snow_amount_inches);

    const smsEnabled = isForecastNotif
      ? user.notify_snow_forecast_sms !== false
      : user.notify_snow_confirmation_sms !== false;
    const emailEnabled = isForecastNotif
      ? user.notify_snow_forecast_email !== false
      : user.notify_snow_confirmation_email !== false;

    await sendAndLogNotification(
      user.user_id,
      user.email,
      user.phone_number,
      user.first_name,
      emailSubject,
      emailHtml,
      smsText,
      smsEnabled,
      emailEnabled
    );
  });

  // Mark the snow event as having triggered notifications
  if (notificationType === 'forecast') {
    await supabaseAdmin
      .from('snow_events')
      .update({
        forecast_sent: true,
        forecast_sent_at: new Date().toISOString()
      })
      .eq('id', snowEvent.id);
  } else {
    await supabaseAdmin
      .from('snow_events')
      .update({
        two_inch_ban_triggered: true,
        ban_triggered_at: new Date().toISOString()
      })
      .eq('id', snowEvent.id);
  }

  return {
    success: true,
    notificationType,
    stats,
    snowEvent: {
      id: snowEvent.id,
      date: snowEvent.event_date,
      snowAmount: snowEvent.snow_amount_inches
    }
  };
}

// API Handler for HTTP calls
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get notification type from request body: 'forecast' or 'confirmation'
  const { notificationType = 'confirmation' } = req.body || {};

  if (!['forecast', 'confirmation'].includes(notificationType)) {
    return res.status(400).json({
      error: 'Invalid notification type. Must be "forecast" or "confirmation"'
    });
  }

  const startTime = Date.now();

  try {
    const result = await sendSnowBanNotifications(notificationType as 'forecast' | 'confirmation');
    return res.status(200).json({
      ...result,
      processingTime: Date.now() - startTime
    });
  } catch (error) {
    console.error('Snow ban notification job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

