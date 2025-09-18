import type { NextApiRequest, NextApiResponse } from 'next';
import { notificationScheduler } from '../../lib/notifications';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only allow POST for security
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔄 Manually triggering notification processing...');
    
    // Process pending reminders
    const results = await notificationScheduler.processPendingReminders();
    
    console.log('📊 Notification processing results:', results);
    
    // Return detailed results
    res.status(200).json({
      success: true,
      message: 'Notification processing completed',
      processed: results.processed,
      successful: results.successful,
      failed: results.failed,
      errors: results.errors,
      timestamp: new Date().toISOString(),
      note: 'Check your email and/or SMS for any notifications that were due'
    });
    
  } catch (error) {
    console.error('❌ Error processing notifications:', error);
    
    res.status(500).json({
      error: 'Failed to process notifications',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}