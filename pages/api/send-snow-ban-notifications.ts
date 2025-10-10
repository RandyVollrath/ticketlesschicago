import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../lib/supabase';

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

function getEmailHtml(firstName: string | null, snowAmount: number, streetInfo: string): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hello,';

  return `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto">
      <h2 style="margin:0 0 12px">🚨 2-Inch Snow Ban ACTIVE - Move Your Car NOW</h2>
      <p>${greeting}</p>
      <p><strong>Chicago has received ${snowAmount}" of snow. The 2-inch parking ban is now in effect on your street.</strong></p>

      <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;margin:20px 0">
        <strong>⚠️ IMMEDIATE ACTION REQUIRED</strong>
        <ul style="margin:8px 0">
          <li><strong>Ban Status:</strong> ACTIVE NOW - move your car immediately</li>
          <li><strong>Your Street:</strong> ${streetInfo}</li>
          <li><strong>Penalty:</strong> $150+ towing fee + $60 ticket + $25/day storage</li>
          <li><strong>Duration:</strong> Until snow is cleared (typically 24-48 hours)</li>
        </ul>
      </div>

      <p><strong>🚗 What to do RIGHT NOW:</strong></p>
      <ol>
        <li>Move your car off ${streetInfo} immediately</li>
        <li>Find parking on a side street (not a main arterial street)</li>
        <li>Monitor city announcements for when the ban is lifted</li>
      </ol>

      <p style="font-size:14px;color:#6b7280;margin-top:24px">
        The 2-inch snow ban helps clear main streets for emergency vehicles and snowplows. The ban remains in effect until snow removal is complete.
      </p>

      <p style="font-size:14px;color:#6b7280;">
        <strong>Official info:</strong> <a href="https://www.chicago.gov/city/en/depts/streets/provdrs/streets_san/svcs/winter_snow_parking_restrictions.html">Chicago.gov Winter Parking</a>
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
      <p style="font-size:12px;color:#6b7280">
        You're receiving this because you're registered with ${BRAND.name} at an address on a 2-inch snow ban street.
        <a href="${BRAND.dashboardUrl}" style="color:#2563eb">Manage preferences</a>
      </p>
    </div>
  `;
}

function getSMSText(snowAmount: number, streetInfo: string): string {
  return `🚨 SNOW BAN ACTIVE! ${snowAmount}" snow detected. MOVE YOUR CAR from ${streetInfo} NOW! Violation = $150+ tow + $60 ticket. Ban active until streets cleared. ${BRAND.dashboardUrl}`;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
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
    noActiveEvent: 0
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

    // Get all users who have opted in for snow ban notifications
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone_number, first_name, home_address_full, notify_snow_ban')
      .eq('notify_snow_ban', true)
      .not('home_address_full', 'is', null);

    if (usersError) throw usersError;

    stats.usersChecked = users?.length || 0;

    if (!users || users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No users opted in for snow ban notifications',
        stats,
        snowEvent
      });
    }

    // Process each user
    for (const user of users) {
      if (!user.home_address_full) continue;

      // For now, we notify ALL users who opted in
      // TODO: Once you get the 2-inch ban street list, filter by street
      // For demonstration, we'll use a simple check
      const address = user.home_address_full.toLowerCase();

      // Check if user has already been notified for this snow event
      const { data: existingNotification } = await supabaseAdmin
        .from('user_snow_ban_notifications')
        .select('id')
        .eq('user_id', user.user_id)
        .eq('snow_event_id', snowEvent.id)
        .single();

      if (existingNotification) {
        stats.alreadyNotified++;
        continue;
      }

      const channels: string[] = [];
      const streetInfo = 'your street'; // TODO: Extract actual street name from address

      // Send SMS
      if (user.phone_number) {
        try {
          await sendSMS(
            user.phone_number,
            getSMSText(snowEvent.snow_amount_inches, streetInfo)
          );
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
            `🚨 2-Inch Snow Ban ACTIVE - Move Your Car (${snowEvent.snow_amount_inches}" snow)`,
            getEmailHtml(user.first_name, snowEvent.snow_amount_inches, streetInfo)
          );
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
            channels,
            status: 'sent'
          });

        stats.usersNotified++;
      }
    }

    // Mark the snow event as having triggered notifications
    await supabaseAdmin
      .from('snow_events')
      .update({
        two_inch_ban_triggered: true,
        ban_triggered_at: new Date().toISOString()
      })
      .eq('id', snowEvent.id);

    return res.status(200).json({
      success: true,
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
