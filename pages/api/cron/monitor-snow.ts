import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * Cron job endpoint to monitor snow conditions
 *
 * This should run every hour during winter months (Nov 1 - Apr 1)
 *
 * Schedule: "0 * * * *" (every hour at minute 0)
 *
 * Workflow:
 * 1. Check weather for snow
 * 2. If 2+ inches detected, create snow event
 * 3. If snow event hasn't been notified, trigger notifications
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();

  try {
    // Step 1: Check for snow
    const checkSnowResponse = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/weather/check-snow`,
      { method: 'POST' }
    );

    if (!checkSnowResponse.ok) {
      throw new Error(`Snow check failed: ${checkSnowResponse.statusText}`);
    }

    const snowCheckResult = await checkSnowResponse.json();

    console.log('Snow check result:', snowCheckResult);

    // Step 2: If snow >= 2 inches detected, send ADMIN notification only
    // (User notifications disabled until we have 2-inch ban street data)
    if (snowCheckResult.needsNotification && snowCheckResult.snowData?.snowAmountInches >= 2.0) {
      console.log('2+ inches of snow detected - notifying admin...');

      const adminNotifyResponse = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/notify-admin-snow`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            snowAmount: snowCheckResult.snowData.snowAmountInches,
            forecastPeriod: snowCheckResult.snowData.forecastPeriod,
            detailedForecast: snowCheckResult.snowData.detailedForecast,
            eventId: snowCheckResult.event?.id
          })
        }
      );

      if (!adminNotifyResponse.ok) {
        console.error('Admin notification failed:', adminNotifyResponse.statusText);
        // Don't throw - continue execution even if email fails
      } else {
        const adminResult = await adminNotifyResponse.json();
        console.log('Admin notification sent:', adminResult);
      }

      // Mark the event as "triggered" (admin notified)
      if (snowCheckResult.event?.id) {
        const { supabaseAdmin } = require('../../../lib/supabase');
        await supabaseAdmin
          .from('snow_events')
          .update({
            two_inch_ban_triggered: true,
            ban_triggered_at: new Date().toISOString()
          })
          .eq('id', snowCheckResult.event.id);
      }

      return res.status(200).json({
        success: true,
        message: 'Snow detected - admin notified (user notifications disabled)',
        snowCheck: snowCheckResult,
        adminNotified: true,
        processingTime: Date.now() - startTime
      });
    }

    // No action needed
    return res.status(200).json({
      success: true,
      message: snowCheckResult.snowDetected
        ? 'Snow detected but below 2-inch threshold'
        : 'No snow detected',
      snowCheck: snowCheckResult,
      processingTime: Date.now() - startTime
    });

  } catch (error) {
    console.error('Snow monitoring cron failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Monitoring failed',
      details: error instanceof Error ? error.message : 'Unknown error',
      processingTime: Date.now() - startTime
    });
  }
}
