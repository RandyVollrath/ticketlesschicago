import type { NextApiRequest, NextApiResponse } from 'next';
import { notificationScheduler } from '../../../lib/notifications';

interface ProcessResult {
  success: boolean;
  processed: number;
  successful: number;
  failed: number;
  errors: string[];
  timestamp: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ProcessResult | { error: string }>
) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Starting notification processing...');
    
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
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error processing notifications:', error);
    
    res.status(500).json({
      error: 'Failed to process notifications'
    });
  }
}