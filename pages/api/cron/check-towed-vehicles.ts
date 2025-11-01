import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import twilio from 'twilio';

// Checks if any user's car was towed recently
// Sends immediate SMS/email alerts
// Run every hour via vercel.json

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Checking for towed user vehicles...');

    // Get all Chicago users with license plates
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, phone_number, email, license_plate, license_state, notify_sms, notify_email')
      .eq('city', 'chicago')
      .not('license_plate', 'is', null);

    if (userError || !users || users.length === 0) {
      console.log('No users to check');
      return res.status(200).json({
        success: true,
        message: 'No users with license plates',
        checked: 0
      });
    }

    console.log(`Checking ${users.length} user vehicles...`);

    let notificationsSent = 0;
    const notifiedUsers: string[] = [];

    // Check each user's plate
    for (const user of users) {
      if (!user.license_plate) continue;

      const plate = user.license_plate.toUpperCase();
      const state = user.license_state || 'IL';

      // Check if this plate was towed in last 24 hours
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const { data: tows, error: towError } = await supabaseAdmin
        .from('towed_vehicles')
        .select('*')
        .eq('plate', plate)
        .eq('state', state)
        .gte('tow_date', yesterday.toISOString())
        .order('tow_date', { ascending: false });

      if (towError || !tows || tows.length === 0) {
        continue; // No tows for this user
      }

      // Check if we already notified about this tow
      const tow = tows[0];
      const alreadyNotified = tow.notified_users?.includes(user.user_id);

      if (alreadyNotified) {
        console.log(`Already notified ${user.user_id} about tow ${tow.inventory_number}`);
        continue;
      }

      console.log(`🚨 FOUND TOW: ${plate} (${state}) - User: ${user.user_id}`);

      // Format tow date
      const towDate = new Date(tow.tow_date);
      const dateStr = towDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });

      const message = `🚨 YOUR CAR WAS TOWED!

Vehicle: ${tow.color} ${tow.make}
Plate: ${plate} (${state})
Towed: ${dateStr}

Location: ${tow.towed_to_address}
Phone: ${tow.tow_facility_phone}
Inventory #: ${tow.inventory_number}

Call immediately to retrieve your vehicle. Fees increase daily.

- Autopilot America`;

      // Send SMS if enabled
      if (user.notify_sms && user.phone_number && TWILIO_PHONE) {
        try {
          await twilioClient.messages.create({
            body: message,
            to: user.phone_number,
            from: TWILIO_PHONE
          });
          console.log(`✓ SMS sent to ${user.phone_number}`);
          notificationsSent++;
        } catch (smsError) {
          console.error(`Error sending SMS to ${user.phone_number}:`, smsError);
        }
      }

      // Send email if enabled
      if (user.notify_email && user.email && RESEND_API_KEY) {
        try {
          const emailHtml = `
            <h2 style="color: #dc2626;">🚨 Your Car Was Towed</h2>
            <p><strong>Vehicle:</strong> ${tow.color} ${tow.make}</p>
            <p><strong>License Plate:</strong> ${plate} (${state})</p>
            <p><strong>Towed:</strong> ${dateStr}</p>
            <hr style="margin: 20px 0; border: 1px solid #e5e7eb;">
            <h3>Impound Location</h3>
            <p><strong>Address:</strong> ${tow.towed_to_address}</p>
            <p><strong>Phone:</strong> ${tow.tow_facility_phone}</p>
            <p><strong>Inventory Number:</strong> ${tow.inventory_number}</p>
            <hr style="margin: 20px 0; border: 1px solid #e5e7eb;">
            <p style="color: #dc2626; font-weight: bold;">⚠️ Call immediately to retrieve your vehicle. Impound fees increase daily.</p>
            <p style="margin-top: 30px; color: #6b7280; font-size: 14px;">- Autopilot America</p>
          `;

          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${RESEND_API_KEY}`
            },
            body: JSON.stringify({
              from: 'Autopilot America <alerts@autopilotamerica.com>',
              to: user.email,
              subject: '🚨 Your Car Was Towed - Act Now',
              html: emailHtml
            })
          });

          if (emailRes.ok) {
            console.log(`✓ Email sent to ${user.email}`);
            notificationsSent++;
          }
        } catch (emailError) {
          console.error(`Error sending email to ${user.email}:`, emailError);
        }
      }

      // Mark this user as notified for this tow
      const updatedNotifiedUsers = [...(tow.notified_users || []), user.user_id];
      await supabaseAdmin
        .from('towed_vehicles')
        .update({ notified_users: updatedNotifiedUsers })
        .eq('id', tow.id);

      notifiedUsers.push(user.user_id);

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Checked ${users.length} users, sent ${notificationsSent} notifications`);

    return res.status(200).json({
      success: true,
      message: 'Towing check complete',
      usersChecked: users.length,
      notificationsSent,
      notifiedUsers
    });

  } catch (error) {
    console.error('Error checking towed vehicles:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
