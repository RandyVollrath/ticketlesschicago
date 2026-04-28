/**
 * Cron Job: Push notifications for upcoming city sticker + license plate renewals
 *
 * Sends a push at 30, 14, 7, and 1 day before each expiry to users who:
 *   - have a city_sticker_expiry and/or license_plate_expiry on file
 *   - have at least one active push token in push_tokens
 *   - have not opted out via push_alert_preferences.{city_sticker,license_plate} = false
 *
 * Dedup is via notification_logs (category='sticker_renewal'|'plate_renewal',
 * notification_type='push', metadata.days_before). One row per (user, sticker, milestone).
 *
 * Schedule: Daily 14:00 UTC (≈9am Chicago in winter, 8am in summer — early
 * enough that the user can act before the day ends).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { sendPushNotification, isFirebaseConfigured } from '../../../lib/firebase-admin';

const REMINDER_DAYS = [30, 14, 7, 1];

interface StickerSpec {
  /** Field on user_profiles holding the YYYY-MM-DD expiry */
  field: 'city_sticker_expiry' | 'license_plate_expiry';
  /** push_alert_preferences key */
  prefKey: 'city_sticker' | 'license_plate';
  /** notification_logs.category */
  logCategory: 'sticker_renewal' | 'plate_renewal';
  /** Title prefix in the push */
  label: string;
}

const SPECS: StickerSpec[] = [
  { field: 'city_sticker_expiry', prefKey: 'city_sticker', logCategory: 'sticker_renewal', label: 'City Sticker' },
  { field: 'license_plate_expiry', prefKey: 'license_plate', logCategory: 'plate_renewal', label: 'License Plate Sticker' },
];

function todayChicagoYMD(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date()); // en-CA → YYYY-MM-DD
}

function daysBetween(today: string, expiry: string): number {
  const t = new Date(today + 'T00:00:00Z').getTime();
  const e = new Date(expiry + 'T00:00:00Z').getTime();
  return Math.round((e - t) / (24 * 60 * 60 * 1000));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Vercel cron auth
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) return res.status(401).json({ error: 'Unauthorized' });

  if (!supabaseAdmin) return res.status(500).json({ error: 'Database not configured' });
  if (!isFirebaseConfigured()) {
    console.warn('[notify-renewal-pushes] Firebase not configured — skipping');
    return res.status(200).json({ success: true, skipped: 'firebase-not-configured' });
  }

  const today = todayChicagoYMD();
  const results = { processed: 0, sent: 0, skipped_dedup: 0, skipped_optout: 0, no_token: 0, errors: 0 };

  // Pull users with at least one sticker date set. Limit to 5000 for safety.
  const { data: users, error: usersErr } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, first_name, city_sticker_expiry, license_plate_expiry, push_alert_preferences')
    .or('city_sticker_expiry.not.is.null,license_plate_expiry.not.is.null')
    .limit(5000);

  if (usersErr) {
    console.error('[notify-renewal-pushes] Failed to load users:', usersErr.message);
    return res.status(500).json({ error: 'Failed to load users' });
  }

  if (!users || users.length === 0) {
    return res.status(200).json({ success: true, message: 'No users with sticker dates', results });
  }

  for (const user of users) {
    try {
      const prefs = (user.push_alert_preferences as Record<string, boolean> | null) || {};

      for (const spec of SPECS) {
        const expiry = (user as any)[spec.field] as string | null;
        if (!expiry) continue;

        // Validate ISO date
        if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;

        const daysUntil = daysBetween(today, expiry);
        if (!REMINDER_DAYS.includes(daysUntil)) continue;

        results.processed++;

        // Opt-out check (default ON if not set)
        if (prefs[spec.prefKey] === false) {
          results.skipped_optout++;
          continue;
        }

        // Dedup: have we already sent THIS milestone for THIS expiry date?
        const { data: existing } = await supabaseAdmin
          .from('notification_logs')
          .select('id')
          .eq('user_id', user.user_id)
          .eq('notification_type', 'push')
          .eq('category', spec.logCategory)
          .eq('metadata->>days_before', String(daysUntil))
          .eq('metadata->>expiry_date', expiry)
          .limit(1)
          .maybeSingle();

        if (existing) {
          results.skipped_dedup++;
          continue;
        }

        // Find an active push token
        const { data: tokens } = await supabaseAdmin
          .from('push_tokens')
          .select('token')
          .eq('user_id', user.user_id)
          .eq('is_active', true)
          .order('last_used_at', { ascending: false })
          .limit(1);

        const token = tokens?.[0]?.token;
        if (!token) {
          results.no_token++;
          continue;
        }

        const dayLabel = daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`;
        const title = `${spec.label} expires ${dayLabel}`;
        const body =
          daysUntil === 1
            ? `Your ${spec.label.toLowerCase()} expires tomorrow (${expiry}). Renew today to avoid a fine.`
            : `Your ${spec.label.toLowerCase()} expires on ${expiry} (${dayLabel}). Renew now to avoid a fine.`;

        const pushResult = await sendPushNotification(token, {
          title,
          body,
          data: {
            type: spec.logCategory,
            expiry_date: expiry,
            days_before: String(daysUntil),
          },
        });

        // Log the attempt regardless of outcome — gives us dedup + observability
        await supabaseAdmin.from('notification_logs').insert({
          user_id: user.user_id,
          notification_type: 'push',
          category: spec.logCategory,
          subject: title,
          content_preview: body.slice(0, 200),
          status: pushResult.success ? 'sent' : 'failed',
          last_error: pushResult.error || null,
          sent_at: pushResult.success ? new Date().toISOString() : null,
          failed_at: pushResult.success ? null : new Date().toISOString(),
          metadata: { days_before: daysUntil, expiry_date: expiry },
        });

        if (pushResult.success) {
          results.sent++;
          console.log(`[notify-renewal-pushes] Sent ${spec.logCategory} day=${daysUntil} to ${user.user_id}`);
        } else {
          results.errors++;
          console.warn(`[notify-renewal-pushes] Push failed ${spec.logCategory} day=${daysUntil} user=${user.user_id}: ${pushResult.error}`);
          if (pushResult.invalidToken) {
            await supabaseAdmin.from('push_tokens')
              .update({ is_active: false })
              .eq('token', token);
          }
        }
      }
    } catch (err) {
      console.error('[notify-renewal-pushes] Error processing user', user.user_id, err);
      results.errors++;
    }
  }

  console.log('[notify-renewal-pushes] done', results);
  return res.status(200).json({ success: true, today, results });
}
