import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

// Checks if any user's car was relocated recently
// Sends immediate SMS/email alerts with the new location
// Run every 15 minutes via vercel.json (offset from tow check)

const RESEND_API_KEY = process.env.RESEND_API_KEY;

// Types for the relocated_vehicles table (not yet in generated types)
interface RelocatedVehicle {
  id: number;
  relocated_date: string;
  make: string | null;
  color: string | null;
  plate: string;
  state: string;
  relocated_from_address: string | null;
  relocated_from_latitude: number | null;
  relocated_from_longitude: number | null;
  relocated_to_address: string | null;
  relocated_reason: string | null;
  service_request_number: string | null;
  created_at: string;
  notified_users: string[];
}

interface UserProfile {
  user_id: string;
  phone_number: string | null;
  email: string | null;
  license_plate: string | null;
  license_state: string | null;
  notify_sms: boolean;
  notify_email: boolean;
  notify_tow: boolean;
}

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
    console.log('Checking for relocated user vehicles...');

    // Get all Chicago users with license plates (case-insensitive city match)
    // Using type assertion since notify_tow column exists but types may not be regenerated
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, phone_number, email, license_plate, license_state, notify_sms, notify_email, notify_tow')
      .ilike('city', 'chicago')
      .not('license_plate', 'is', null) as unknown as { data: UserProfile[] | null; error: any };

    if (userError || !users || users.length === 0) {
      console.log('No users to check');
      return res.status(200).json({
        success: true,
        message: 'No users with license plates',
        checked: 0
      });
    }

    console.log(`Checking ${users.length} user vehicles for relocations...`);

    let notificationsSent = 0;
    const notifiedUsers: string[] = [];

    // Check each user's plate
    for (const user of users) {
      if (!user.license_plate) continue;

      const plate = user.license_plate.toUpperCase();
      const state = user.license_state || 'IL';

      // Check if this plate was relocated in last 48 hours
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      // Query relocated_vehicles table (using type assertion for new table)
      const { data: relocations, error: reloError } = await supabaseAdmin
        .from('relocated_vehicles' as any)
        .select('*')
        .eq('plate', plate)
        .eq('state', state)
        .gte('relocated_date', twoDaysAgo.toISOString())
        .order('relocated_date', { ascending: false }) as unknown as { data: RelocatedVehicle[] | null; error: any };

      if (reloError || !relocations || relocations.length === 0) {
        continue; // No relocations for this user
      }

      const relocation = relocations[0];

      if (user.notify_tow === false) {
        console.log(`Skipping ${user.user_id}: tow/relocation notifications disabled`);
        continue;
      }

      // Pre-claim dedup row. Partial unique index on user_notifications
      // (user_id, notification_type='relocation_alert', metadata->>'relocation_id')
      // means concurrent cron fires can't both send — second one's INSERT
      // fails with 23505 and we skip.
      const { data: claim, error: claimErr } = await supabaseAdmin
        .from('user_notifications')
        .insert({
          user_id: user.user_id,
          notification_type: 'relocation_alert',
          sent_at: new Date().toISOString(),
          status: 'sending',
          channels: [],
          metadata: {
            relocation_id: String(relocation.id),
            service_request_number: relocation.service_request_number,
            plate,
          },
        } as any)
        .select('id')
        .single();

      if (claimErr?.code === '23505') {
        console.log(`DB-deduped relocation alert for ${user.user_id}/relocation ${relocation.id}`);
        continue;
      }
      if (claimErr || !claim) {
        console.error(`REFUSING TO SEND relocation alert to ${user.user_id}: claim failed — ${sanitizeErrorMessage(claimErr)}`);
        continue;
      }
      const claimId = (claim as any).id;

      console.log(`📍 FOUND RELOCATION: ${plate} (${state}) - User: ${user.user_id}`);

      // Format relocation date/time
      const reloDate = new Date(relocation.relocated_date);
      const dateStr = reloDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
      const timeStr = reloDate.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      // Build map link for "to" location (where car is now) - this is most important for SMS
      // Use simple Google Maps URL that works on all devices and opens native map apps
      const toMapUrl = relocation.relocated_to_address
        ? `https://maps.google.com/?q=${encodeURIComponent(relocation.relocated_to_address + ', Chicago, IL')}`
        : null;

      const message = `📍 AUTOPILOT AMERICA ALERT
Your car was RELOCATED (not towed)!

Vehicle: ${relocation.color || ''} ${relocation.make || 'Vehicle'}
Plate: ${plate} (${state})
Moved: ${dateStr} at ${timeStr}

FROM: ${relocation.relocated_from_address || 'Unknown'}

TO: ${relocation.relocated_to_address || 'Nearby location'}${toMapUrl ? `\n📍 Map: ${toMapUrl}` : ''}

Reason: ${relocation.relocated_reason || 'City operation'}

Your car is NOT impounded - just moved nearby. No fees required.

Reply STOP to unsubscribe.`;

      // Send SMS if enabled
      if (user.notify_sms && user.phone_number) {
        try {
          const result = await sendClickSendSMS(user.phone_number, message);
          if (result.success) {
            console.log(`✓ SMS sent to ${user.phone_number}`);
            notificationsSent++;
          } else {
            console.error(`Error sending SMS to ${user.phone_number}:`, result.error);
          }
        } catch (smsError) {
          console.error(`Error sending SMS to ${user.phone_number}:`, smsError);
        }
      }

      // Send email if enabled
      if (user.notify_email && user.email && RESEND_API_KEY) {
        try {
          // Build Google Maps links - use simple format that works universally
          // Prefer lat/lng for "from" since we have it, address for "to"
          const fromMapLink = relocation.relocated_from_latitude && relocation.relocated_from_longitude
            ? `https://maps.google.com/?q=${relocation.relocated_from_latitude},${relocation.relocated_from_longitude}`
            : relocation.relocated_from_address
              ? `https://maps.google.com/?q=${encodeURIComponent(relocation.relocated_from_address + ', Chicago, IL')}`
              : null;

          const toMapLink = relocation.relocated_to_address
            ? `https://maps.google.com/?q=${encodeURIComponent(relocation.relocated_to_address + ', Chicago, IL')}`
            : null;

          const emailHtml = `
            <h2 style="color: #2563eb;">📍 Your Car Was Relocated</h2>
            <p style="color: #059669; font-weight: bold;">Good news: Your car was NOT towed to an impound lot - it was just moved nearby!</p>

            <p><strong>Vehicle:</strong> ${relocation.color || ''} ${relocation.make || 'Vehicle'}</p>
            <p><strong>License Plate:</strong> ${plate} (${state})</p>
            <p><strong>Relocated:</strong> ${dateStr} at ${timeStr}</p>

            <hr style="margin: 20px 0; border: 1px solid #e5e7eb;">

            <h3>Location Details</h3>
            <table style="border-collapse: collapse; width: 100%;">
              <tr>
                <td style="padding: 10px; background: #fef2f2; border-radius: 8px;">
                  <strong>📍 Moved FROM:</strong><br>
                  ${relocation.relocated_from_address || 'Unknown location'}
                  ${fromMapLink ? `<br><a href="${fromMapLink}" style="color: #2563eb;">View on Map →</a>` : ''}
                </td>
              </tr>
              <tr><td style="padding: 5px;"></td></tr>
              <tr>
                <td style="padding: 10px; background: #ecfdf5; border-radius: 8px;">
                  <strong>📍 Moved TO:</strong><br>
                  ${relocation.relocated_to_address || 'Nearby location'}
                  ${toMapLink ? `<br><a href="${toMapLink}" style="color: #2563eb;">View on Map →</a>` : ''}
                </td>
              </tr>
            </table>

            <hr style="margin: 20px 0; border: 1px solid #e5e7eb;">

            <p><strong>Reason:</strong> ${relocation.relocated_reason || 'City operation'}</p>
            <p><strong>Service Request #:</strong> ${relocation.service_request_number || 'N/A'}</p>

            <div style="margin-top: 20px; padding: 15px; background: #f0fdf4; border-radius: 8px; border-left: 4px solid #22c55e;">
              <p style="margin: 0; color: #166534;"><strong>✓ No fees required</strong> - Your car is just parked at a new location.</p>
            </div>

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
              subject: '📍 Your Car Was Relocated - Here\'s Where',
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

      await supabaseAdmin
        .from('user_notifications')
        .update({ status: 'sent' })
        .eq('id', claimId);
      notifiedUsers.push(user.user_id);

      // Legacy: keep notified_users[] array in sync for downstream readers.
      try {
        await supabaseAdmin
          .from('relocated_vehicles' as any)
          .update({ notified_users: [...(relocation.notified_users || []), user.user_id] })
          .eq('id', relocation.id);
      } catch { /* non-critical — unique index is the source of truth now */ }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✅ Checked ${users.length} users, sent ${notificationsSent} relocation notifications`);

    return res.status(200).json({
      success: true,
      message: 'Relocation check complete',
      usersChecked: users.length,
      notificationsSent,
      notifiedUsers
    });

  } catch (error) {
    console.error('Error checking relocated vehicles:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}
