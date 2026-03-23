/**
 * DOT Permit Notification Cron
 *
 * Notifies web users about upcoming DOT permits near their home address.
 * Geocodes user addresses (caching lat/lng on user_profiles), queries
 * the dot_permits table for permits within 30m, and sends email/SMS.
 *
 * Schedule: Daily at 8 AM CT (1 PM UTC)
 *
 * Notification triggers:
 * - Permit starts tomorrow (advance warning)
 * - Permit starts today (day-of reminder)
 * - New permit found that wasn't in a previous notification
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { sendClickSendSMS } from '../../../lib/sms-service';
import { sms, email } from '../../../lib/message-templates';
import { EMAIL } from '../../../lib/config';
import {
  logMessageSent,
  logMessageSkipped,
  logMessageError,
  checkRecentlySent,
} from '../../../lib/message-audit-logger';

const resend = new Resend(process.env.RESEND_API_KEY);
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
const GEOCODE_BATCH_SIZE = 10; // Don't hammer Google API
const PERMIT_RADIUS_METERS = 30; // Same block face only

interface UserProfile {
  user_id: string;
  email: string;
  phone_number: string | null;
  first_name: string | null;
  home_address_full: string | null;
  home_address_lat: number | null;
  home_address_lng: number | null;
  notify_email: boolean;
  notify_sms: boolean;
  notify_dot_permits: boolean;
  city: string | null;
}

interface DotPermit {
  application_number: string;
  work_type: string;
  work_description: string | null;
  start_date: string;
  end_date: string;
  street_number_from: number | null;
  street_number_to: number | null;
  direction: string | null;
  street_name: string | null;
  suffix: string | null;
  street_closure: string | null;
  parking_meter_bagging: boolean;
  comments: string | null;
  application_name: string | null;
  distance_m: number;
}

/**
 * Geocode an address via Google Maps API
 */
async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY) {
    console.warn('[notify-dot-permits] No GOOGLE_API_KEY configured');
    return null;
  }

  const normalizedAddress = address.toLowerCase().includes('chicago')
    ? address
    : `${address}, Chicago, IL`;

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(normalizedAddress)}&key=${GOOGLE_API_KEY}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await response.json();

    if (data.status === 'OK' && data.results?.length > 0) {
      const location = data.results[0].geometry.location;
      return { lat: location.lat, lng: location.lng };
    }

    console.warn(`[notify-dot-permits] Geocode failed for "${address}": ${data.status}`);
    return null;
  } catch (err) {
    console.error(`[notify-dot-permits] Geocode error for "${address}":`, err);
    return null;
  }
}

/**
 * Format a date string like "Mar 5" from ISO timestamp
 */
function formatPermitDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
}

/**
 * Build street display name from permit fields
 */
function buildStreetName(permit: DotPermit): string {
  const parts: string[] = [];
  if (permit.street_number_from) {
    parts.push(
      permit.street_number_to && permit.street_number_to !== permit.street_number_from
        ? `${permit.street_number_from}-${permit.street_number_to}`
        : `${permit.street_number_from}`
    );
  }
  if (permit.direction) parts.push(permit.direction);
  if (permit.street_name) parts.push(permit.street_name);
  if (permit.suffix) parts.push(permit.suffix);
  return parts.join(' ') || 'nearby street';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  if (process.env.NODE_ENV === 'production' && cronSecret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database not configured' });
  }

  console.log('[notify-dot-permits] Starting DOT permit notification run...');

  const stats = {
    usersChecked: 0,
    usersGeocoded: 0,
    usersWithPermits: 0,
    emailsSent: 0,
    smsSent: 0,
    skipped: 0,
    errors: 0,
  };

  try {
    // 1. Fetch Chicago users who opted into DOT permit alerts
    const { data: users, error: usersError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, email, phone_number, first_name, home_address_full, home_address_lat, home_address_lng, notify_email, notify_sms, notify_dot_permits, city')
      .eq('notify_dot_permits', true)
      .not('home_address_full', 'is', null)
      .or('city.is.null,city.eq.chicago'); // Only Chicago users (null defaults to Chicago)

    if (usersError) {
      console.error('[notify-dot-permits] Error fetching users:', usersError);
      return res.status(500).json({ error: 'Failed to fetch users' });
    }

    if (!users || users.length === 0) {
      console.log('[notify-dot-permits] No eligible users found');
      return res.status(200).json({ success: true, stats, message: 'No eligible users' });
    }

    console.log(`[notify-dot-permits] Found ${users.length} eligible users`);

    // 2. Geocode users who don't have cached lat/lng
    const needsGeocoding = users.filter(u => u.home_address_lat === null || u.home_address_lng === null);
    if (needsGeocoding.length > 0) {
      console.log(`[notify-dot-permits] Geocoding ${needsGeocoding.length} user addresses...`);

      for (let i = 0; i < needsGeocoding.length; i += GEOCODE_BATCH_SIZE) {
        const batch = needsGeocoding.slice(i, i + GEOCODE_BATCH_SIZE);
        await Promise.all(batch.map(async (user) => {
          const coords = await geocodeAddress(user.home_address_full!);
          if (coords) {
            // Cache the coordinates on user_profiles
            await supabaseAdmin
              .from('user_profiles')
              .update({ home_address_lat: coords.lat, home_address_lng: coords.lng })
              .eq('user_id', user.user_id);
            user.home_address_lat = coords.lat;
            user.home_address_lng = coords.lng;
            stats.usersGeocoded++;
          }
        }));

        // Small delay between batches to avoid rate limiting
        if (i + GEOCODE_BATCH_SIZE < needsGeocoding.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }

    // 3. For each user with coordinates, query DOT permits nearby
    const today = new Date();
    const chicagoToday = today.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }); // YYYY-MM-DD

    for (const user of users) {
      if (!user.home_address_lat || !user.home_address_lng) {
        continue; // Skip users we couldn't geocode
      }

      stats.usersChecked++;

      try {
        // Query permits near this user
        const { data: permits, error: permitsError } = await supabaseAdmin.rpc(
          'get_dot_permits_at_location',
          {
            user_lat: user.home_address_lat,
            user_lng: user.home_address_lng,
            distance_meters: PERMIT_RADIUS_METERS,
            check_date: chicagoToday,
          }
        );

        if (permitsError) {
          console.error(`[notify-dot-permits] RPC error for user ${user.user_id}:`, permitsError);
          stats.errors++;
          continue;
        }

        if (!permits || permits.length === 0) {
          continue; // No permits near this user
        }

        // Filter to permits starting today or tomorrow (most actionable)
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

        const actionablePermits = permits.filter((p: DotPermit) => {
          const startDate = new Date(p.start_date).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
          return startDate <= tomorrowStr; // Starting today, tomorrow, or already active
        });

        if (actionablePermits.length === 0) {
          continue; // No permits starting soon enough to alert about
        }

        stats.usersWithPermits++;

        // 4. Build notification data
        const permitData = actionablePermits.map((p: DotPermit) => ({
          workType: p.work_type || 'Street Permit',
          streetName: buildStreetName(p),
          startDate: formatPermitDate(p.start_date),
          endDate: formatPermitDate(p.end_date),
          streetClosure: p.street_closure,
          applicationName: p.application_name,
          comments: p.comments,
        }));

        // 5. Deduplication — check if we already notified about these permits recently
        // Use application numbers as the dedup key
        const permitKeys = actionablePermits
          .map((p: DotPermit) => p.application_number)
          .sort()
          .join(',');
        const messageKey = `dot_permit_${permitKeys.substring(0, 100)}`;

        const recentlySent = await checkRecentlySent(user.user_id, messageKey, 48);
        if (recentlySent) {
          stats.skipped++;
          await logMessageSkipped({
            userId: user.user_id,
            userEmail: user.email,
            messageKey,
            messageChannel: 'email',
            contextData: { permit_count: actionablePermits.length },
            reason: 'already_sent_48h',
          });
          continue;
        }

        // 6. Send email notification
        if (user.notify_email !== false && user.email) {
          try {
            const emailContent = email.dotPermitAlert(
              { firstName: user.first_name || undefined, email: user.email },
              permitData
            );

            const { error: sendError } = await resend.emails.send({
              from: EMAIL.FROM_DEFAULT,
              to: [user.email],
              subject: emailContent.subject,
              html: emailContent.html,
              text: emailContent.text,
              headers: {
                'List-Unsubscribe': '<https://autopilotamerica.com/unsubscribe>',
                'X-Entity-Ref-ID': `dot-permit-${user.user_id}-${chicagoToday}`,
              },
              replyTo: EMAIL.REPLY_TO,
            });

            if (sendError) {
              throw sendError;
            }

            stats.emailsSent++;
            await logMessageSent({
              userId: user.user_id,
              userEmail: user.email,
              messageKey,
              messageChannel: 'email',
              contextData: {
                permit_count: actionablePermits.length,
                permits: permitData.map(p => `${p.workType} on ${p.streetName}`),
              },
              messagePreview: emailContent.subject,
              costCents: 0.1,
            });
          } catch (err) {
            console.error(`[notify-dot-permits] Email error for ${user.user_id}:`, err);
            stats.errors++;
            await logMessageError({
              userId: user.user_id,
              userEmail: user.email,
              messageKey,
              messageChannel: 'email',
              contextData: { permit_count: actionablePermits.length },
              reason: 'email_send_failed',
              errorDetails: err,
            });
          }
        }

        // 7. Send SMS notification (first permit only — SMS is short)
        if (user.notify_sms !== false && user.phone_number) {
          try {
            const firstPermit = permitData[0];
            const smsMessage = sms.dotPermitAlert(firstPermit);

            const result = await sendClickSendSMS(user.phone_number, smsMessage);
            if (result.success) {
              stats.smsSent++;
              await logMessageSent({
                userId: user.user_id,
                userPhone: user.phone_number,
                messageKey: `${messageKey}_sms`,
                messageChannel: 'sms',
                contextData: { permit_count: 1 },
                messagePreview: smsMessage.substring(0, 200),
                externalMessageId: result.messageId,
                costCents: 2,
              });
            } else {
              throw new Error(result.error || 'SMS send failed');
            }
          } catch (err) {
            console.error(`[notify-dot-permits] SMS error for ${user.user_id}:`, err);
            await logMessageError({
              userId: user.user_id,
              userPhone: user.phone_number || undefined,
              messageKey: `${messageKey}_sms`,
              messageChannel: 'sms',
              contextData: { permit_count: 1 },
              reason: 'sms_send_failed',
              errorDetails: err,
            });
          }
        }
      } catch (err) {
        console.error(`[notify-dot-permits] Error processing user ${user.user_id}:`, err);
        stats.errors++;
      }
    }

    console.log('[notify-dot-permits] Completed:', JSON.stringify(stats));
    return res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('[notify-dot-permits] Fatal error:', err);
    return res.status(500).json({ error: 'Internal error', details: String(err) });
  }
}
