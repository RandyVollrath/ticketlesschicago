import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sanitizeErrorMessage } from '../../../lib/error-utils';
import { createTowAlert, markAlertNotified } from '../../../lib/contest-intelligence';
import { pushService } from '../../../lib/push-service';
import { notificationLogger } from '../../../lib/notification-logger';
import { getAdminAlertEmails } from '../../../lib/admin-alert-emails';

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

      // Track per-channel success so we can detect "tow alert reached no-one"
      // and force a fallback send. A tow is high-urgency enough that even
      // users who opted out of SMS/email should get at minimum an admin
      // escalation if push also fails.
      let smsDelivered = false;
      let emailDelivered = false;
      let pushDelivered = false;

      // Send SMS if enabled
      if (user.notify_sms && user.phone_number) {
        const smsLogId = await notificationLogger.log({
          user_id: user.user_id,
          phone: user.phone_number,
          notification_type: 'sms',
          category: 'tow_alert',
          content_preview: message.slice(0, 200),
          status: 'pending',
          metadata: { tow_id: String(tow.id), plate },
        });
        try {
          const result = await sendClickSendSMS(user.phone_number, message);
          if (result.success) {
            console.log(`✓ SMS sent to ${user.phone_number}`);
            smsDelivered = true;
            notificationsSent++;
            if (smsLogId) await notificationLogger.updateStatus(smsLogId, 'sent', result.messageId);
          } else {
            console.error(`Error sending SMS to ${user.phone_number}:`, result.error);
            if (smsLogId) await notificationLogger.updateStatus(smsLogId, 'failed', undefined, result.error);
          }
        } catch (smsError: any) {
          console.error(`Error sending SMS to ${user.phone_number}:`, smsError);
          if (smsLogId) await notificationLogger.updateStatus(smsLogId, 'failed', undefined, smsError?.message || String(smsError));
        }
      }

      // Send email if enabled
      if (user.notify_email && user.email && RESEND_API_KEY) {
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
        const emailLogId = await notificationLogger.log({
          user_id: user.user_id,
          email: user.email,
          notification_type: 'email',
          category: 'tow_alert',
          subject: '🚨 Your Car Was Towed - Act Now',
          content_preview: `${tow.color} ${tow.make} (${plate}) towed to ${tow.towed_to_address}`.slice(0, 200),
          status: 'pending',
          metadata: { tow_id: String(tow.id), plate },
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
              html: emailHtml
            })
          });

          if (emailRes.ok) {
            const data = await emailRes.json().catch(() => ({}));
            console.log(`✓ Email sent to ${user.email}`);
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

      // Send push notification (most urgent — user's car is impounded)
      // Note: pushService.sendToUser already writes to notification_logs
      // internally (see lib/push-service.ts:133), so no extra log call here.
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

      // Sentinel: if NO channel delivered — because user has no push token,
      // opted out of SMS/email, or gateways are all down — escalate to an
      // admin alert so the user doesn't silently miss a tow notification.
      // Tow is treated as a safety-critical alert.
      if (!smsDelivered && !emailDelivered && !pushDelivered) {
        console.warn(`🚨 Tow alert for user ${user.user_id} reached ZERO channels — escalating to admin`);
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
            notify_sms: !!user.notify_sms,
            notify_email: !!user.notify_email,
          },
        });
        if (RESEND_API_KEY) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
              body: JSON.stringify({
                from: 'Autopilot America <alerts@autopilotamerica.com>',
                to: getAdminAlertEmails(),
                subject: `🚨 Tow alert reached zero channels — user ${user.user_id}`,
                html: `<p>User <code>${user.user_id}</code> had a tow detected (plate <code>${plate}</code>, tow id <code>${tow.id}</code>) but no notification channel delivered.</p>
                       <p>SMS: consent=${!!user.notify_sms}, phone=${!!user.phone_number}<br>
                       Email: consent=${!!user.notify_email}, email=${!!user.email}<br>
                       Push: no active tokens or all failed</p>
                       <p>Reach out manually — vehicle impound fees accrue daily.</p>`,
              }),
            });
          } catch {}
        }
      }

      // Create tow alert in the intelligence system
      try {
        const towAlert = await createTowAlert(supabaseAdmin, {
          user_id: user.user_id,
          alert_type: 'tow',
          plate: plate,
          state: state,
          tow_location: tow.tow_zone || undefined,
          impound_location: tow.towed_to || undefined,
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
              supabaseAdmin,
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
