import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { getUsersOnSnowRoutes } from '../../lib/snow-route-matcher';
import { sendClickSendSMS } from '../../lib/sms-service';
import { sanitizeErrorMessage } from '../../lib/error-utils';
import { quickEmail, greeting as greet, p, callout, section, button, divider, bulletList, steps, esc } from '../../lib/email-template';
import { getChicagoDateISO } from '../../lib/chicago-timezone-utils';

const BRAND = {
  name: 'Autopilot America',
  dashboardUrl: 'https://autopilotamerica.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'Autopilot America <noreply@autopilotamerica.com>',
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

function getForecastEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string, userAddress: string, moveByTime?: string): string {
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;
  const deadlineText = moveByTime || 'as soon as possible';
  const safeStreet = esc(streetInfo);

  return quickEmail({
    preheader: `${snowAmount}" snow forecast — move your car off ${streetInfo} ${deadlineText}`,
    headerTitle: `${snowAmount}" Snow Coming`,
    headerSubtitle: `Move your car ${deadlineText}`,
    body: [
      greet(firstName || undefined),
      p(`<strong>Chicago is forecasted to receive ${snowAmount}" of snow, which may trigger the 2-inch parking ban on your street. Move your car ${deadlineText}.</strong>`),
      callout('warning', `Move Your Car ${deadlineText.charAt(0).toUpperCase() + deadlineText.slice(1)}`, bulletList([
        `<strong>Your Street:</strong> ${safeStreet}`,
        `<strong>Move By:</strong> ${deadlineText}`,
        `<strong>Forecast:</strong> ${snowAmount} inches`,
        '<strong>Ban Activates:</strong> Once 2+ inches has actually fallen',
        '<strong>Penalty:</strong> $150 towing + $60 ticket + $25/day storage = <strong>$235+ total</strong>',
      ])),
      button('Find Safe Parking Near You', safeParkingUrl, { color: '#EC4899' }),
      p('See which streets near you are NOT affected by the snow ban', { size: '13px', color: '#6B7280', center: true }),
      section('2-Inch Snow Ban Rules', bulletList([
        'Applies to 500 miles of main streets in Chicago',
        'Activates when 2+ inches of snow has actually fallen (any time, any day)',
        'Remains in effect until snow removal is complete (24-48 hours typically)',
        'Cars parked on affected streets may be ticketed and relocated',
      ])),
      section('What To Do', steps([
        'Monitor weather conditions closely',
        `Be prepared to move your car off ${safeStreet}`,
        '<strong>We\'ll send you a confirmation alert when 2+ inches has actually fallen</strong>',
        'When confirmed, move to a side street (not a main arterial)',
      ])),
      divider(),
      p('<strong>Important:</strong> The 2-inch snow ban is not yet in effect. This is a forecast alert to help you prepare.', { size: '13px', color: '#6B7280' }),
    ].join(''),
  });
}

function getConfirmationEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string, userAddress: string): string {
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;
  const safeStreet = esc(streetInfo);

  return quickEmail({
    preheader: `${snowAmount}" snow has fallen — move your car off ${streetInfo} now`,
    headerTitle: '2+ Inches of Snow Has Fallen',
    headerSubtitle: 'Ban may be activated at any time',
    body: [
      greet(firstName || undefined),
      p(`<strong>Chicago has received ${snowAmount}" of snow. The city may activate the 2-inch parking ban on ${safeStreet} at any time.</strong>`),
      callout('danger', 'Move Your Car To Be Safe', bulletList([
        `<strong>Snow Threshold Met:</strong> ${snowAmount}" has fallen (2"+ triggers eligibility)`,
        '<strong>Ban Status:</strong> May be activated by the city at any time',
        `<strong>Your Street:</strong> ${safeStreet}`,
        '<strong>Penalty:</strong> $150 towing + $60 ticket + $25/day storage = <strong>$235+ total</strong>',
      ])),
      button('Find Safe Parking Near You', safeParkingUrl, { color: '#EC4899' }),
      p('See which streets near you are NOT affected by the snow ban', { size: '13px', color: '#6B7280', center: true }),
      section('Recommended Steps', steps([
        `Move your car off ${safeStreet} to be safe`,
        'Park on a side street (not a main arterial street)',
        'Monitor @ChicagoDOT on X/Twitter for official ban activation announcements',
      ])),
      divider(),
      p('<strong>Note:</strong> The city decides when to activate the ban based on conditions. Once 2+ inches has fallen, the ban can be activated at any time without additional notice.', { size: '13px', color: '#6B7280' }),
    ].join(''),
  });
}

function getForecastSMSText(snowAmount: number, streetInfo: string, userAddress: string, moveByTime?: string): string {
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;
  const deadlineText = moveByTime ? ` Move car ${moveByTime}` : ' Move car soon';
  return `❄️ ${snowAmount}" snow coming.${deadlineText} off ${streetInfo} or risk $235+ tow. Safe parking: ${safeParkingUrl}`;
}

function getConfirmationSMSText(snowAmount: number, streetInfo: string, userAddress: string): string {
  const safeParkingUrl = `https://autopilotamerica.com/check-your-street?address=${encodeURIComponent(userAddress)}&mode=snow`;
  return `🚨 ${snowAmount}" snow has fallen. 2-inch ban MAY BE ACTIVE on ${streetInfo}. Move your car to be safe! Find parking: ${safeParkingUrl}`;
}

// Templates for users NOT on snow routes (awareness alerts)
function getAwarenessForecastEmailHtml(firstName: string | null, snowAmount: number, moveByTime?: string): string {
  const deadlineText = moveByTime || 'as soon as possible';
  return quickEmail({
    preheader: `${snowAmount}" snow forecast — 2-inch parking ban may activate on main streets`,
    headerTitle: `${snowAmount}" Snow Coming`,
    headerSubtitle: '2-inch ban alert for your awareness',
    body: [
      greet(firstName || undefined),
      p(`<strong>Chicago is forecasted to receive ${snowAmount}" of snow, which may trigger the 2-inch parking ban on main streets. If parked on an arterial, move ${deadlineText}.</strong>`),
      callout('info', 'For Your Awareness',
        'Your registered address is <strong>not</strong> on a 2-inch snow ban route. However, if you park on any main arterial streets in Chicago, you should be prepared to move your car.'),
      section('2-Inch Snow Ban Rules', bulletList([
        'Applies to 500 miles of main streets in Chicago',
        'Activates when 2+ inches of snow has actually fallen',
        'Cars parked on affected streets may be ticketed ($60) and towed ($150+)',
        'Look for "2-inch snow" parking signs on streets you use',
      ])),
      divider(),
      p('<strong>Tip:</strong> Read street parking signs carefully before leaving your car, especially on major streets during winter.', { size: '13px', color: '#6B7280' }),
    ].join(''),
  });
}

function getAwarenessConfirmationEmailHtml(firstName: string | null, snowAmount: number): string {
  return quickEmail({
    preheader: `${snowAmount}" snow has fallen — 2-inch parking ban may be active on main streets`,
    headerTitle: '2+ Inches of Snow Has Fallen',
    headerSubtitle: 'Ban may be active — check where you\'re parked',
    body: [
      greet(firstName || undefined),
      p(`<strong>Chicago has received ${snowAmount}" of snow. The city may activate the 2-inch parking ban on main arterial streets at any time.</strong>`),
      callout('warning', 'Check Where You\'re Parked',
        'Your registered address is <strong>not</strong> on a 2-inch snow ban route. However, if you\'ve parked on any main arterial street, you should consider moving your car to avoid a potential $60 ticket and $150+ towing fee.'),
      section('What To Check', bulletList([
        'Look at the parking signs where your car is currently parked',
        'If you see "2-inch snow" restrictions, consider moving your car',
        'Park on side streets (not main arterials) to be safe',
        'Monitor @ChicagoDOT on X/Twitter for official ban announcements',
      ])),
      divider(),
      p('<strong>Note:</strong> The city decides when to activate the ban — it\'s not automatic. Once activated, the ban typically lasts 24-48 hours until snow removal is complete.', { size: '13px', color: '#6B7280' }),
    ].join(''),
  });
}

function getAwarenessForecastSMSText(snowAmount: number, moveByTime?: string): string {
  const deadlineText = moveByTime ? ` Move ${moveByTime}` : ' Move soon';
  return `❄️ ${snowAmount}" snow coming. 2-inch ban may activate.${deadlineText} if parked on main streets or risk $235+ tow. -Autopilot`;
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
    .maybeSingle();

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
      .maybeSingle();

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
          notification_date: getChicagoDateISO(),
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

  // Extract snow timing from metadata - prefer the formatted version (e.g., "Sunday morning")
  // Fall back to forecast_period (e.g., "Sunday") if formatted version not available
  const forecastPeriod = snowEvent.metadata?.snow_start_formatted
    || snowEvent.metadata?.forecast_period
    || snowEvent.metadata?.latest_forecast_period;

  // Process users ON snow routes (urgent alerts with their specific street) - PARALLEL
  await processBatch(snowRouteUsersToNotify, async (user) => {
    const streetInfo = user.route.on_street;
    const userAddress = user.home_address_full || user.route.on_street;

    const emailSubject = isForecastNotif
      ? `❄️ ${snowEvent.snow_amount_inches}" Snow Coming - Move Your Car ${forecastPeriod || 'Now'}`
      : `🚨 ${snowEvent.snow_amount_inches}" Snow Fell - 2-Inch Ban May Be Active`;
    const emailHtml = isForecastNotif
      ? getForecastEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo, userAddress, forecastPeriod)
      : getConfirmationEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo, userAddress);
    const smsText = isForecastNotif
      ? getForecastSMSText(snowEvent.snow_amount_inches, streetInfo, userAddress, forecastPeriod)
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
      ? `❄️ ${snowEvent.snow_amount_inches}" Snow Coming - Move ${forecastPeriod || 'Soon'} If On Main Street`
      : `🚨 ${snowEvent.snow_amount_inches}" Snow Fell - 2-Inch Ban May Be Active`;
    const emailHtml = isForecastNotif
      ? getAwarenessForecastEmailHtml(user.first_name, snowEvent.snow_amount_inches, forecastPeriod)
      : getAwarenessConfirmationEmailHtml(user.first_name, snowEvent.snow_amount_inches);
    const smsText = isForecastNotif
      ? getAwarenessForecastSMSText(snowEvent.snow_amount_inches, forecastPeriod)
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
      error: sanitizeErrorMessage(error)
    });
  }
}

