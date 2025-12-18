import type { NextApiRequest, NextApiResponse } from 'next';
// Use fixed notification system that queries users table
import { notificationScheduler } from '../../../lib/notifications';
import { runSeasonalWinterSyncsIfNeeded } from '../../../lib/winter-sync-helpers';

interface ProcessResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  timestamp: string;
  seasonalSync?: {
    ran: boolean;
    syncType?: string;
    recordsProcessed?: number;
    syncErrors?: string[];
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResult | { error: string }>
) {
  // Allow both GET (for Vercel cron) and POST requests
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Starting notification processing...');

    // Check if today is a seasonal sync day (Nov 1 or Dec 1)
    // This consolidates the winter sync crons to stay under Vercel's 20 cron limit
    const seasonalSync = await runSeasonalWinterSyncsIfNeeded();
    if (seasonalSync.ran) {
      console.log(`🌨️ Seasonal sync completed: ${seasonalSync.syncType}`, seasonalSync.result);
    }

    // Process pending reminders
    const results = await notificationScheduler.processPendingReminders();

    console.log('📊 Notification processing results:', results);

    // Return results
    res.status(200).json({
      success: true,
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString(),
      seasonalSync: seasonalSync.ran ? {
        ran: true,
        syncType: seasonalSync.syncType,
        recordsProcessed: seasonalSync.result?.recordsProcessed,
        syncErrors: seasonalSync.result?.errors,
      } : { ran: false },
    });
    
  } catch (error) {
    console.error('❌ Error processing notifications:', error);
    
    res.status(500).json({
      error: 'Failed to process notifications'
    });
  }
}