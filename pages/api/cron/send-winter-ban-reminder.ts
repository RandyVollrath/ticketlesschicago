import type { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron job to send Winter Overnight Parking Ban reminders
 * Scheduled to run on November 30th at 9:00 AM CT
 *
 * This sends a one-time reminder to users whose addresses are on
 * winter overnight parking ban streets (3am-7am ban, Dec 1 - Apr 1)
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Verify cron secret
  const authHeader = req.headers.authorization;
  const keyParam = req.query.key as string | undefined;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const isAuthorized = authHeader === `Bearer ${process.env.CRON_SECRET}` || keyParam === process.env.CRON_SECRET;

  if (!isVercelCron && !isAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('🌨️ Starting Winter Ban Reminder job...');

  try {
    // Check if today is Nov 30 (or allow manual override)
    const now = new Date();
    const isNov30 = now.getMonth() === 10 && now.getDate() === 30; // Month is 0-indexed
    const forceRun = req.query.force === 'true';

    if (!isNov30 && !forceRun) {
      console.log(`ℹ️ Today is ${now.toDateString()}, not Nov 30. Skipping.`);
      return res.status(200).json({
        success: true,
        message: 'Not Nov 30, skipping winter ban notifications',
        date: now.toISOString()
      });
    }

    // Call the existing send-winter-ban-notifications endpoint
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://autopilotamerica.com';
    const response = await fetch(`${baseUrl}/api/send-winter-ban-notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.CRON_SECRET}`
      }
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('❌ Winter ban notification failed:', result);
      return res.status(500).json({
        success: false,
        error: 'Failed to send winter ban notifications'
      });
    }

    console.log('✅ Winter ban notifications sent:', result);
    return res.status(200).json({
      success: true,
      message: 'Winter ban notifications processed',
      result
    });

  } catch (error: any) {
    console.error('❌ Winter ban cron job failed:', error);
    return res.status(500).json({
      success: false,
      error: sanitizeErrorMessage(error)
    });
  }
}
