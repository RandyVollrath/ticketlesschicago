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

    // Step 2: If snow >= 2 inches detected, send notifications
    if (snowCheckResult.needsNotification && snowCheckResult.snowData?.snowAmountInches >= 2.0) {
      const { supabaseAdmin } = require('../../../lib/supabase');
      const event = snowCheckResult.event;

      // Determine notification type based on whether snow has actually fallen
      const isActualSnowfall = snowCheckResult.snowData.isCurrentlySnowing;
      const notificationType = isActualSnowfall ? 'confirmation' : 'forecast';

      console.log(`2+ inches of snow ${isActualSnowfall ? 'falling NOW' : 'forecasted'} - sending ${notificationType} notifications...`);

      // Check if we've already sent this type of notification
      const { data: existingEvent } = await supabaseAdmin
        .from('snow_events')
        .select('*')
        .eq('id', event?.id)
        .single();

      const alreadySentForecast = existingEvent?.forecast_sent;
      const alreadySentConfirmation = existingEvent?.two_inch_ban_triggered;

      // Only send if we haven't sent this type yet
      const shouldSendForecast = notificationType === 'forecast' && !alreadySentForecast;
      const shouldSendConfirmation = notificationType === 'confirmation' && !alreadySentConfirmation;

      if (shouldSendForecast || shouldSendConfirmation) {
        // Send user notifications
        const userNotifyResponse = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/send-snow-ban-notifications`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              notificationType
            })
          }
        );

        let userNotifyResult = null;
        if (!userNotifyResponse.ok) {
          console.error('User notification failed:', userNotifyResponse.statusText);
        } else {
          userNotifyResult = await userNotifyResponse.json();
          console.log('User notifications sent:', userNotifyResult);
        }

        // Also notify admin
        const adminNotifyResponse = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/admin/notify-admin-snow`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snowAmount: snowCheckResult.snowData.snowAmountInches,
              forecastPeriod: snowCheckResult.snowData.forecastPeriod,
              detailedForecast: snowCheckResult.snowData.detailedForecast,
              eventId: event?.id,
              notificationType,
              userStats: userNotifyResult?.stats
            })
          }
        );

        if (!adminNotifyResponse.ok) {
          console.error('Admin notification failed:', adminNotifyResponse.statusText);
        }

        return res.status(200).json({
          success: true,
          message: `${notificationType} notifications sent`,
          snowCheck: snowCheckResult,
          notificationType,
          userNotifications: userNotifyResult,
          processingTime: Date.now() - startTime
        });
      } else {
        console.log(`${notificationType} notification already sent for this event`);
        return res.status(200).json({
          success: true,
          message: `${notificationType} notification already sent`,
          snowCheck: snowCheckResult,
          processingTime: Date.now() - startTime
        });
      }
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
