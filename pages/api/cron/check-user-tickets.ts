import type { NextApiRequest, NextApiResponse } from 'next';
import { checkAllUserTickets } from '../../../lib/ticket-monitor';

/**
 * Cron job to check for new parking tickets for all users
 * Run every 3 hours via vercel.json
 *
 * Schedule: 0 *\/3 * * * (every 3 hours)
 */
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
    console.log('🎯 Starting user ticket check cron job...');

    await checkAllUserTickets();

    return res.status(200).json({
      success: true,
      message: 'Ticket checks complete',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in ticket check cron:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
}

// Increase timeout for Playwright operations
export const config = {
  maxDuration: 300, // 5 minutes max
};
