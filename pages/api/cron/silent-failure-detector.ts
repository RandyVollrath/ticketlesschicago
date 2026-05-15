import type { NextApiRequest, NextApiResponse } from 'next';
import { supabaseAdmin } from '../../../lib/supabase';
import { Resend } from 'resend';
import { getAdminAlertEmails } from '../../../lib/admin-alert-emails';

// Daily detector for the highest-trust-damage failure mode: scheduled street
// cleaning happened (or is about to), and a paid user in that ward+section did
// NOT receive any alert in the relevant window. The user doesn't even know to
// complain — they get a $75 ticket and silently churn at renewal.
//
// Strategy: for each cleaning_date in [yesterday, today, tomorrow], join the
// scheduled wards+sections against user_profiles, then check user_notifications
// for a 'street_cleaning' row with that cleaning_date. Anything missing is a gap.
//
// Schedule (vercel.json crons): daily at 16:00 UTC = 11:00 CDT / 10:00 CST.
// Runs AFTER morning_reminder (~07:00 CT) and evening_reminder (~17:00 CT the
// day before), so by 11:00 CT every alert that should have fired for "today"
// has fired.

const FROM_EMAIL = 'Autopilot America <alerts@autopilotamerica.com>';

function chicagoDateISO(offsetDays: number = 0): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  const y = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric' }).format(now);
  const m = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: '2-digit' }).format(now);
  const d = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', day: '2-digit' }).format(now);
  return `${y}-${m}-${d}`;
}

interface Gap {
  userId: string;
  email: string | null;
  ward: string;
  section: string;
  cleaningDate: string;
  daysFromToday: number;
  hasEmail: boolean;
  hasSms: boolean;
  hasPush: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secret = process.env.CRON_SECRET;
  const isAuthorized = isVercelCron || (secret ? authHeader === `Bearer ${secret}` : false);
  if (!isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!supabaseAdmin) {
    return res.status(500).json({ error: 'Database unavailable' });
  }

  const yesterday = chicagoDateISO(-1);
  const today = chicagoDateISO(0);
  const tomorrow = chicagoDateISO(1);
  const dateRange = [yesterday, today, tomorrow];

  // 1) Get scheduled cleanings in the window.
  const { data: schedule, error: scheduleError } = await supabaseAdmin
    .from('street_cleaning_schedule')
    .select('ward, section, cleaning_date')
    .in('cleaning_date', dateRange);

  if (scheduleError) {
    console.error('schedule query failed', scheduleError);
    return res.status(500).json({ error: 'schedule_query_failed' });
  }

  if (!schedule || schedule.length === 0) {
    return res.status(200).json({ ok: true, gaps: 0, note: 'no scheduled cleanings in window' });
  }

  // De-dup ward+section pairs we care about.
  const wardSectionPairs = new Map<string, { ward: string; section: string; cleaning_date: string }[]>();
  for (const row of schedule) {
    const key = `${row.ward}|${row.section}`;
    const list = wardSectionPairs.get(key) || [];
    list.push(row);
    wardSectionPairs.set(key, list);
  }

  // 2) Get all paid+active users in any of those ward+section pairs.
  // We check ALL paid users with ward/section set, then filter by membership in
  // wardSectionPairs in JS — Supabase's PostgREST doesn't support multi-column IN.
  const { data: users, error: usersError } = await supabaseAdmin
    .from('user_profiles')
    .select('user_id, email, phone_number, home_address_ward, home_address_section, is_paid, notify_email, notify_sms, push_alert_preferences, snooze_until_date')
    .eq('is_paid', true)
    .not('home_address_ward', 'is', null)
    .not('home_address_section', 'is', null);

  if (usersError) {
    console.error('users query failed', usersError);
    return res.status(500).json({ error: 'users_query_failed' });
  }

  const affectedUsers = (users || []).filter(u => {
    const key = `${u.home_address_ward}|${u.home_address_section}`;
    if (!wardSectionPairs.has(key)) return false;
    if (u.snooze_until_date && u.snooze_until_date >= today) return false;
    return true;
  });

  if (affectedUsers.length === 0) {
    return res.status(200).json({ ok: true, gaps: 0, note: 'no paid users in affected zones' });
  }

  // 3) Fetch all user_notifications for those users covering the window.
  const userIds = affectedUsers.map(u => u.user_id).filter(Boolean) as string[];
  const { data: sentNotifs, error: notifsError } = await supabaseAdmin
    .from('user_notifications')
    .select('user_id, cleaning_date, status')
    .in('user_id', userIds)
    .eq('notification_type', 'street_cleaning')
    .in('cleaning_date', dateRange);

  if (notifsError) {
    console.error('notifs query failed', notifsError);
    return res.status(500).json({ error: 'notifs_query_failed' });
  }

  const sentSet = new Set(
    (sentNotifs || [])
      .filter(n => n.status !== 'failed')
      .map(n => `${n.user_id}|${n.cleaning_date}`)
  );

  // 4) For each (user, cleaning_date) pair that SHOULD have had a notification,
  // check if one exists. Missing => gap.
  const gaps: Gap[] = [];
  for (const user of affectedUsers) {
    const key = `${user.home_address_ward}|${user.home_address_section}`;
    const relevantCleanings = wardSectionPairs.get(key) || [];
    for (const cleaning of relevantCleanings) {
      const dedupKey = `${user.user_id}|${cleaning.cleaning_date}`;
      if (sentSet.has(dedupKey)) continue;
      // Yesterday is in the past — only flag if the cleaning already happened
      // and we should have sent something. Tomorrow we only flag if it's the
      // night-before window (which means evening_reminder should have fired).
      const daysFromToday =
        cleaning.cleaning_date === today ? 0
        : cleaning.cleaning_date === yesterday ? -1
        : 1;
      // For "tomorrow", only flag if it's after 18:00 CT (evening reminder
      // should have fired). Cron runs at 11:00 CT so tomorrow is too early.
      if (daysFromToday === 1) continue;
      gaps.push({
        userId: user.user_id,
        email: user.email,
        ward: user.home_address_ward!,
        section: user.home_address_section!,
        cleaningDate: cleaning.cleaning_date,
        daysFromToday,
        hasEmail: user.notify_email !== false && !!user.email,
        hasSms: user.notify_sms === true && !!user.phone_number,
        hasPush: !!(user.push_alert_preferences && (user.push_alert_preferences as any).street_cleaning !== false),
      });
    }
  }

  // 5) Always email a summary so we know the detector itself ran.
  const recipients = getAdminAlertEmails();
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  const hasGaps = gaps.length > 0;
  const subject = hasGaps
    ? `[Silent Failure] ${gaps.length} street-cleaning alert gap(s) — ${today}`
    : `[Silent Failure Check] OK — ${affectedUsers.length} users covered for ${today}`;

  const gapRows = gaps
    .map(g => `<tr>
      <td>${g.email || g.userId}</td>
      <td>Ward ${g.ward} / Section ${g.section}</td>
      <td>${g.cleaningDate}${g.daysFromToday === -1 ? ' (yesterday)' : ' (today)'}</td>
      <td>${[g.hasEmail && 'email', g.hasSms && 'sms', g.hasPush && 'push'].filter(Boolean).join(', ') || 'none enabled'}</td>
    </tr>`)
    .join('');

  const html = `
    <h2>Street-cleaning silent-failure detector</h2>
    <p><strong>Window:</strong> ${yesterday} → ${today}</p>
    <p><strong>Affected paid users in scheduled-cleaning zones:</strong> ${affectedUsers.length}</p>
    <p><strong>Gaps (no notification sent):</strong> ${gaps.length}</p>
    ${hasGaps ? `
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px;margin-top:12px">
        <thead><tr><th>User</th><th>Zone</th><th>Cleaning date</th><th>Channels enabled</th></tr></thead>
        <tbody>${gapRows}</tbody>
      </table>
      <p style="margin-top:16px;color:#666">Each row above is a paid user whose block had scheduled cleaning in the past 24h but who did NOT get a street_cleaning notification. Check pages/api/street-cleaning/process.ts cron health and the user's notify preferences.</p>
    ` : `<p style="color:#15803D">All affected users received at least one street_cleaning notification. ✓</p>`}
    <p style="margin-top:20px;font-size:11px;color:#999">Cron: pages/api/cron/silent-failure-detector.ts · ${new Date().toISOString()}</p>
  `;

  if (resend) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipients,
        subject,
        html,
      });
    } catch (err) {
      console.error('failed to email silent-failure summary', err);
    }
  }

  return res.status(200).json({
    ok: true,
    window: { yesterday, today, tomorrow },
    scheduledCleanings: schedule.length,
    affectedUsers: affectedUsers.length,
    gaps: gaps.length,
    emailed: !!resend,
  });
}
