import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { createTowAlert, markAlertNotified } from '../../../lib/contest-intelligence';
import { pushService } from '../../../lib/push-service';
import { notificationLogger } from '../../../lib/notification-logger';

// Checks if any user's car was towed recently
// Sends immediate SMS/email alerts
// Run every hour via vercel.json

const RESEND_API_KEY = process.env.RESEND_API_KEY;

export const config = { maxDuration: 60 };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify cron secret
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('CRON_SECRET not configured — rejecting request');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    console.log('Checking for towed user vehicles...');

    // Get all Chicago users with license plates (case-insensitive city match)
    const { data: users, error: userError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, phone_number, email, license_plate, license_state, notify_sms, notify_email, notify_tow')
      .ilike('city', 'chicago')
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

      // Check if this plate was towed in last 48 hours
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const { data: tows, error: towError } = await supabaseAdmin
        .from('towed_vehicles')
        .select('*')
        .eq('plate', plate)
        .eq('state', state)
        .gte('tow_date', twoDaysAgo.toISOString())
        .order('tow_date', { ascending: false });

      if (towError || !tows || tows.length === 0) {
        continue; // No tows for this user
      }

      const tow = tows[0];

      if (user.notify_tow === false) {
        console.log(`Skipping ${user.user_id}: tow notifications disabled`);
        continue;
      }

      // Pre-claim dedup slot. Partial unique index on user_notifications
      // (user_id, notification_type='tow_alert', metadata->>'tow_id') means
      // a second cron fire's INSERT fails with 23505 and we skip the send.
      // This replaces the old notified_users[] array read-modify-write race.
      const { data: claim, error: claimErr } = await supabaseAdmin
        .from('user_notifications')
        .insert({
          user_id: user.user_id,
          notification_type: 'tow_alert',
          sent_at: new Date().toISOString(),
          status: 'sending',
          channels: [],
          metadata: { tow_id: String(tow.id), inventory_number: tow.inventory_number, plate },
        } as any)
        .select('id')
        .single();

      if (claimErr?.code === '23505') {
        console.log(`DB-deduped tow alert for ${user.user_id}/tow ${tow.id}`);
        continue;
      }
      if (claimErr || !claim) {
        console.error(`REFUSING TO SEND tow alert to ${user.user_id}: claim failed — ${sanitizeErrorMessage(claimErr)}`);
        continue;
      }
      const claimId = (claim as any).id;

      console.log(`🚨 FOUND TOW: ${plate} (${state}) - User: ${user.user_id}`);

      // Format tow date (no time - Chicago doesn't provide it)
      const towDate = new Date(tow.tow_date);
      const dateStr = towDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });

      const message = `🚨 AUTOPILOT AMERICA ALERT
Your car was towed!

Vehicle: ${tow.color} ${tow.make}
Plate: ${plate} (${state})
Towed: ${dateStr}

IMPOUND LOT:
${tow.towed_to_address}
${tow.tow_facility_phone}

Inventory #: ${tow.inventory_number}

Call immediately to retrieve your vehicle. Fees increase daily.

Reply STOP to unsubscribe from Autopilot America alerts.`;

      // Tow alerts are safety-critical transactional alerts — the user's
      // vehicle is impounded and fees accrue daily. We send on every
      // channel where contact info exists, regardless of the user's
      // marketing opt-out flags. The STOP footer in the message preserves
      // legal opt-out (CTIA carrier compliance) for SMS, and the email
      // includes a List-Unsubscribe header.
      let smsDelivered = false;
      let emailDelivered = false;
      let pushDelivered = false;

      // SMS — attempt whenever we have a phone number, safety override.
      const smsPhone = user.phone_number;
      if (smsPhone) {
        const smsLogId = await notificationLogger.log({
          user_id: user.user_id,
          phone: smsPhone,
          notification_type: 'sms',
          category: 'tow_alert',
          content_preview: message.slice(0, 200),
          status: 'pending',
          metadata: { tow_id: String(tow.id), plate, safety_override: !user.notify_sms },
        });
        try {
          const result = await sendClickSendSMS(smsPhone, message);
          if (result.success) {
            console.log(`✓ SMS sent to ${smsPhone}${!user.notify_sms ? ' (safety override)' : ''}`);
            smsDelivered = true;
            notificationsSent++;
            if (smsLogId) await notificationLogger.updateStatus(smsLogId, 'sent', result.messageId);
          } else {
            console.error(`Error sending SMS to ${smsPhone}:`, result.error);
            if (smsLogId) await notificationLogger.updateStatus(smsLogId, 'failed', undefined, result.error);
          }
        } catch (smsError: any) {
          console.error(`Error sending SMS to ${smsPhone}:`, smsError);
          if (smsLogId) await notificationLogger.updateStatus(smsLogId, 'failed', undefined, smsError?.message || String(smsError));
        }
      }

      // Email — attempt whenever we have an email address.
      if (user.email && RESEND_API_KEY) {
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
            <p style="margin-top: 30px; color: #6b7280; font-size: 12px;">Tow alerts are safety-critical transactional notifications. If you no longer want ANY messages from Autopilot America, email support@autopilotamerica.com.</p>
            <p style="margin-top: 10px; color: #6b7280; font-size: 14px;">- Autopilot America</p>
          `;
        const emailLogId = await notificationLogger.log({
          user_id: user.user_id,
          email: user.email,
          notification_type: 'email',
          category: 'tow_alert',
          subject: '🚨 Your Car Was Towed - Act Now',
          content_preview: `${tow.color} ${tow.make} (${plate}) towed to ${tow.towed_to_address}`.slice(0, 200),
          status: 'pending',
          metadata: { tow_id: String(tow.id), plate, safety_override: !user.notify_email },
        });
        try {
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
              html: emailHtml,
              headers: {
                'List-Unsubscribe': '<mailto:support@autopilotamerica.com>',
              },
            })
          });

          if (emailRes.ok) {
            const data = await emailRes.json().catch(() => ({}));
            console.log(`✓ Email sent to ${user.email}${!user.notify_email ? ' (safety override)' : ''}`);
            emailDelivered = true;
            notificationsSent++;
            if (emailLogId) await notificationLogger.updateStatus(emailLogId, 'sent', data.id);
          } else {
            const body = await emailRes.text().catch(() => '');
            if (emailLogId) await notificationLogger.updateStatus(emailLogId, 'failed', undefined, body.slice(0, 500));
          }
        } catch (emailError: any) {
          console.error(`Error sending email to ${user.email}:`, emailError);
          if (emailLogId) await notificationLogger.updateStatus(emailLogId, 'failed', undefined, emailError?.message || String(emailError));
        }
      }

      // Push — always attempt. pushService.sendToUser already logs to
      // notification_logs internally (see lib/push-service.ts:133).
      try {
        const pushResult: any = await pushService.sendToUser(user.user_id, {
          title: '🚨 Your Car Was Towed!',
          body: `${tow.color} ${tow.make} (${plate}) towed to ${tow.towed_to_address}. Call ${tow.tow_facility_phone} immediately.`,
          data: {
            type: 'tow_alert',
            plate,
            impound_address: tow.towed_to_address || '',
            impound_phone: tow.tow_facility_phone || '',
            inventory_number: tow.inventory_number || '',
          },
          userId: user.user_id,
          category: 'tow_alert',
        });
        if (pushResult?.success && pushResult?.successCount > 0) {
          console.log(`✓ Push notification sent for tow alert (${plate})`);
          pushDelivered = true;
          notificationsSent++;
        }
      } catch (pushError) {
        console.error(`Push notification failed for tow alert:`, pushError);
      }

      // Record the zero-delivery case so we can track it in QA reports,
      // but we don't page an admin — there's nothing a human follow-up
      // call would accomplish that the automatic delivery above hasn't
      // already. If nothing delivered, it's because we had no contact
      // info at all, which is a data problem to surface in the dashboard.
      if (!smsDelivered && !emailDelivered && !pushDelivered) {
        console.warn(`⚠️ Tow alert for user ${user.user_id} reached ZERO channels (no contact info on file)`);
        await notificationLogger.log({
          user_id: user.user_id,
          notification_type: 'email',
          category: 'tow_alert_zero_delivery',
          subject: `Tow alert had zero delivery channels for user ${user.user_id}`,
          status: 'failed',
          metadata: {
            tow_id: String(tow.id),
            plate,
            has_phone: !!user.phone_number,
            has_email: !!user.email,
            reason: (!user.phone_number && !user.email) ? 'no_contact_info' : 'all_gateways_failed',
          },
        });
      }

      // Create tow alert in the intelligence system
      try {
        // towed_vehicles only stores tow_facility_phone + towed_to_address.
        // tow_zone / towed_to (the impound facility name) aren't columns
        // we capture from the portal — both reads here were always
        // undefined, so the older code was passing undefined through
        // anyway; dropped the dead refs.
        const towAlert = await createTowAlert(supabaseAdmin as any, {
          user_id: user.user_id,
          alert_type: 'tow',
          plate: plate,
          state: state,
          impound_address: tow.towed_to_address || undefined,
          impound_phone: tow.tow_facility_phone || undefined,
          tow_date: tow.tow_date,
          discovered_at: new Date().toISOString(),
          related_ticket_ids: [],
          contesting_tow: false,
        });

        if (towAlert) {
          // Mark the alert as notified if we sent notifications
          if (notificationsSent > 0) {
            await markAlertNotified(
              supabaseAdmin as any,
              towAlert.id,
              user.notify_sms && user.phone_number ? 'sms' : 'email'
            );
          }
          console.log(`✓ Created tow alert ${towAlert.id} for user ${user.user_id}`);
        }
      } catch (alertError) {
        console.error(`Failed to create tow alert for user ${user.user_id}:`, alertError);
      }

      // Update the dedup claim row with final channel list + status.
      await supabaseAdmin
        .from('user_notifications')
        .update({ status: 'sent', channels: ['sms', 'email', 'push'].filter(c =>
          (c === 'sms' && user.notify_sms && user.phone_number) ||
          (c === 'email' && user.notify_email && user.email) ||
          c === 'push'
        ) })
        .eq('id', claimId);
      notifiedUsers.push(user.user_id);

      // Legacy: keep notified_users[] array in sync for any downstream reader.
      try {
        const { data: freshTow } = await supabaseAdmin
          .from('towed_vehicles')
          .select('notified_users')
          .eq('id', tow.id)
          .maybeSingle();
        const currentNotified = (freshTow?.notified_users as string[]) || [];
        if (!currentNotified.includes(user.user_id)) {
          await supabaseAdmin
            .from('towed_vehicles')
            .update({ notified_users: [...currentNotified, user.user_id] })
            .eq('id', tow.id);
        }
      } catch { /* non-critical, unique index is the source of truth now */ }

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
      error: sanitizeErrorMessage(error)
    });
  }
}
