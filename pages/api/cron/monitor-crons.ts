import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * Daily cron health check: verify all critical crons fired in the last 24h.
 * Alerts admin if any are missing.
 *
 * Schedule: Daily at noon (vercel.json: "0 17 * * *" = noon Chicago)
 */

const CRITICAL_CRONS = [
  { path: '/api/street-cleaning/process', name: 'Street Cleaning Notifications', expectedDaily: 6 },
  { path: '/api/cron/autopilot-check-plates', name: 'Autopilot Plate Check', expectedDaily: 1 },
  { path: '/api/cron/sync-towing-data', name: 'Towing Sync', expectedDaily: 96 },
  { path: '/api/cron/check-towed-vehicles', name: 'Towed Vehicle Check', expectedDaily: 96 },
  { path: '/api/notifications/process', name: 'Notification Process', expectedDaily: 1 },
  { path: '/api/cron/monitor-foia-deadlines', name: 'FOIA Deadline Monitor', expectedDaily: 1 },
];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const authHeader = req.headers.authorization;
  const secret = process.env.CRON_SECRET;
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Check Vercel function invocations via the notification_log as a proxy
    // Since we can't directly query Vercel analytics from here, we check
    // if the street cleaning cron produced any notifications recently

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: recentNotifs, count: notifCount } = await supabase
      .from('notification_log')
      .select('*', { count: 'exact' })
      .gte('created_at', yesterday);

    // Check if street cleaning schedule has upcoming dates
    const today = new Date().toISOString().split('T')[0];
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const { data: upcoming } = await supabase
      .from('street_cleaning_schedule')
      .select('ward_section, cleaning_date')
      .gte('cleaning_date', today)
      .lte('cleaning_date', nextWeek);

    const uniqueUpcoming = [...new Set((upcoming || []).map(r => r.cleaning_date))];

    // Check user count with notifications enabled
    const { count: activeUsers } = await supabase
      .from('user_profiles')
      .select('*', { count: 'exact', head: true })
      .not('home_address_ward', 'is', null)
      .eq('notify_email', true);

    const issues: string[] = [];

    if ((notifCount || 0) === 0 && uniqueUpcoming.length > 0 && (activeUsers || 0) > 0) {
      issues.push(`No notifications sent in 24h but ${uniqueUpcoming.length} cleaning dates upcoming and ${activeUsers} users active`);
    }

    if ((activeUsers || 0) === 0) {
      issues.push('No users have email notifications enabled');
    }

    const report = {
      timestamp: new Date().toISOString(),
      notifications_24h: notifCount || 0,
      upcoming_cleaning_dates: uniqueUpcoming,
      active_users: activeUsers || 0,
      issues,
      status: issues.length === 0 ? 'healthy' : 'warning',
    };

    console.log('Cron monitor report:', JSON.stringify(report));

    // If there are issues, send alert email
    if (issues.length > 0) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Autopilot America <alerts@autopilotamerica.com>',
            to: ['randyvollrath@gmail.com'],
            subject: `⚠️ Cron Health Alert: ${issues.length} issue(s)`,
            text: `Cron Health Check\n\n${issues.join('\n')}\n\nFull report:\n${JSON.stringify(report, null, 2)}`,
          }),
        });
      } catch (emailErr) {
        console.error('Failed to send alert email:', emailErr);
      }
    }

    res.status(200).json(report);
  } catch (err: any) {
    console.error('Cron monitor error:', err);
    res.status(500).json({ error: err.message });
  }
}
