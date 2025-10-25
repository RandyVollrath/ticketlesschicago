import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';
import { getUsersOnSnowRoutes } from '../../lib/snow-route-matcher';

const BRAND = {
  name: 'Ticketless America',
  dashboardUrl: 'https://ticketlessamerica.com/dashboard',
  emailFrom: process.env.RESEND_FROM || 'Ticketless America <noreply@ticketlessamerica.com>',
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
        custom_string: 'snow-ban-notification'
      }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`ClickSend ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function getForecastEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';

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

function getConfirmationEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">🚨 2-Inch Snow Ban Active on Your Street</h2>
      <p>${greeting}</p>
      <p><strong>Chicago has received ${snowAmount}" of snow. The 2-inch parking ban is now in effect on ${streetInfo}.</strong></p>

      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;margin:20px 0">
        <strong>⚠️ Action Required</strong>
        <ul style="margin:8px 0">
          <li><strong>Ban Status:</strong> Active now</li>
          <li><strong>Your Street:</strong> ${streetInfo}</li>
          <li><strong>Penalty:</strong> $150 towing + $60 ticket + $25/day storage = <strong>$235+ total</strong></li>
          <li><strong>Duration:</strong> Until snow is cleared (typically 24-48 hours)</li>
        </ul>
      </div>

      <p><strong>🚗 Next Steps:</strong></p>
      <ol>
        <li>Move your car off ${streetInfo} as soon as possible</li>
        <li>Park on a side street (not a main arterial street)</li>
        <li>Monitor city announcements for when the ban is lifted</li>
      </ol>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        The 2-inch snow ban helps clear main streets for emergency vehicles and snowplows. The ban remains in effect until snow removal is complete.
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

function getForecastSMSText(snowAmount: number, streetInfo: string): string {
  return `❄️ ${snowAmount}" snow forecasted. 2-inch parking ban may activate on ${streetInfo}. We'll confirm when snow falls. Prepare to move your car. ${BRAND.dashboardUrl}`;
}

function getConfirmationSMSText(snowAmount: number, streetInfo: string): string {
  return `🚨 2-inch snow ban active on ${streetInfo}. ${snowAmount}" has fallen. Please move your car to avoid $235+ penalty. ${BRAND.dashboardUrl}`;
}

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

  try {
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
      return res.status(200).json({
        success: true,
        message: 'No active 2-inch snow event to notify about',
        stats
      });
    }

    stats.noActiveEvent = 0;

    // Get users on snow routes (filters by home_address_full matching snow_routes table)
    const usersOnSnowRoutes = await getUsersOnSnowRoutes();

    stats.usersChecked = usersOnSnowRoutes.length;

    if (usersOnSnowRoutes.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No users found on 2-inch snow ban streets',
        stats,
        snowEvent
      });
    }

    // Process each user on snow routes
    for (const user of usersOnSnowRoutes) {
      // Check if user has already been notified for this snow event and notification type
      const { data: existingNotification } = await supabaseAdmin
        .from('user_snow_ban_notifications')
        .select('id')
        .eq('user_id', user.user_id)
        .eq('snow_event_id', snowEvent.id)
        .eq('notification_type', notificationType)
        .single();

      if (existingNotification) {
        stats.alreadyNotified++;
        continue;
      }

      const channels: string[] = [];
      const streetInfo = user.route.on_street;

      // Choose the right email/SMS templates based on notification type
      const isForecast = notificationType === 'forecast';
      const emailSubject = isForecast
        ? `❄️ ${snowEvent.snow_amount_inches}" Snow Forecasted - 2-Inch Ban May Apply`
        : `🚨 2-Inch Snow Ban Active on Your Street (${snowEvent.snow_amount_inches}" snow)`;
      const emailHtml = isForecast
        ? getForecastEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo)
        : getConfirmationEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo);
      const smsText = isForecast
        ? getForecastSMSText(snowEvent.snow_amount_inches, streetInfo)
        : getConfirmationSMSText(snowEvent.snow_amount_inches, streetInfo);

      // Send SMS
      if (user.phone_number) {
        try {
          await sendSMS(user.phone_number, smsText);
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
          await sendEmail(user.email, emailSubject, emailHtml);
          channels.push('email');
          stats.emailsSent++;
        } catch (error) {
          console.error(`Email failed for user ${user.user_id}:`, error);
          stats.emailsFailed++;
        }
      }

      // Log the notification
      if (channels.length > 0) {
        await supabaseAdmin
          .from('user_snow_ban_notifications')
          .insert({
            user_id: user.user_id,
            snow_event_id: snowEvent.id,
            notification_date: new Date().toISOString().split('T')[0],
            notification_type: notificationType,
            channels,
            status: 'sent'
          });

        stats.usersNotified++;
      }
    }

    // Mark the snow event as having triggered notifications
    // Update different fields based on notification type
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

    return res.status(200).json({
      success: true,
      notificationType,
      stats,
      snowEvent: {
        id: snowEvent.id,
        date: snowEvent.event_date,
        snowAmount: snowEvent.snow_amount_inches
      },
      processingTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('Snow ban notification job failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Job failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      stats
    });
  }
}
