import type { NextApiRequest, NextApiResponse } from 'next';
import { checkForSnow } from '../../../lib/weather-service';
import { supabaseAdmin } from '../../../lib/supabase';
import { sanitizeErrorMessage } from '../../../lib/error-utils';

/**
 * Cron job endpoint to monitor snow conditions
 *
 * This should run every 30 minutes during winter months (Nov-Mar)
 *
 * Schedule: "0,30 * * 11,12,1,2,3 *"
 *
 * Workflow:
 * 1. Check weather for snow (with retry logic)
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
    const today = new Date().toISOString().split('T')[0];

    const { data: activeEvent } = await supabaseAdmin
      .from('snow_events')
      .select('*')
      .eq('is_active', true)
      .gte('event_date', today)
      .single();

    // If no active event, skip full check (except on hourly runs at :00 or :30)
    const currentMinute = new Date().getMinutes();
    const isScheduledRun = currentMinute === 0 || currentMinute === 30;

    if (!activeEvent && !isScheduledRun) {
      return res.status(200).json({
        success: true,
        message: 'No active snow event - skipping check',
        skipped: true,
        processingTime: Date.now() - startTime
      });
    }

    // Step 1: Check for snow with retry logic
    let snowData = null;
    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        snowData = await checkForSnow();
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        console.error(`Weather check attempt ${attempt} failed:`, error);
        if (attempt < 3) {
          // Wait before retry (1s, 2s)
          await new Promise(resolve => setTimeout(resolve, attempt * 1000));
        }
      }
    }

    if (!snowData) {
      throw new Error(`Weather check failed after 3 attempts`);
    }

    console.log('Snow check result:', snowData);

    // Build a result object similar to what check-snow API returns
    let snowCheckResult: any = {
      success: true,
      snowDetected: snowData.hasSnow,
      twoInchBanTriggered: false,
      needsNotification: false,
      snowData,
      event: null
    };

    // If snow >= 2 inches, handle snow event creation/update
    if (snowData.snowAmountInches >= 2.0) {
      // Check if we already have a snow event for today
      const { data: existingEvent } = await supabaseAdmin
        .from('snow_events')
        .select('*')
        .eq('event_date', today)
        .single();

      if (!existingEvent) {
        // Create new snow event
        const { data: newEvent, error: insertError } = await supabaseAdmin
          .from('snow_events')
          .insert({
            event_date: today,
            snow_amount_inches: snowData.snowAmountInches,
            forecast_source: 'nws',
            is_active: true,
            two_inch_ban_triggered: false,
            metadata: {
              forecast_period: snowData.forecastPeriod,
              detailed_forecast: snowData.detailedForecast,
              is_currently_snowing: snowData.isCurrentlySnowing,
              checked_at: new Date().toISOString()
            }
          })
          .select()
          .single();

        if (insertError) {
          console.error('Error creating snow event:', insertError);
        } else {
          console.log('Created new snow event:', newEvent);
          snowCheckResult.event = newEvent;
          snowCheckResult.needsNotification = true;
        }
      } else {
        // Update existing event
        await supabaseAdmin
          .from('snow_events')
          .update({
            snow_amount_inches: Math.max(existingEvent.snow_amount_inches, snowData.snowAmountInches),
            is_active: true,
            metadata: {
              ...existingEvent.metadata,
              latest_forecast_period: snowData.forecastPeriod,
              latest_detailed_forecast: snowData.detailedForecast,
              latest_check_at: new Date().toISOString()
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', existingEvent.id);

        snowCheckResult.event = existingEvent;
        snowCheckResult.twoInchBanTriggered = existingEvent.two_inch_ban_triggered;
        snowCheckResult.needsNotification = !existingEvent.two_inch_ban_triggered;
      }
    }

    // Step 2: If snow >= 2 inches detected, send notifications
    if (snowCheckResult.needsNotification && snowData.snowAmountInches >= 2.0) {
      const event = snowCheckResult.event;

      // Determine notification type:
      // - 'forecast': When 2+ inches is predicted (send early warning)
      // - 'confirmation': When 2+ inches has accumulated (send urgent alert)
      const hasAccumulated = snowData.isCurrentlySnowing;
      const notificationType = hasAccumulated ? 'confirmation' : 'forecast';

      console.log(`2+ inches of snow ${hasAccumulated ? 'has accumulated' : 'forecasted'} - sending ${notificationType} notifications...`);

      // Check if we've already sent this type of notification
      const { data: eventCheck } = await supabaseAdmin
        .from('snow_events')
        .select('*')
        .eq('id', event?.id)
        .single();

      const alreadySentForecast = eventCheck?.forecast_sent;
      const alreadySentConfirmation = eventCheck?.two_inch_ban_triggered;

      // Only send if we haven't sent this type yet
      const shouldSendForecast = notificationType === 'forecast' && !alreadySentForecast;
      const shouldSendConfirmation = notificationType === 'confirmation' && !alreadySentConfirmation;

      if (shouldSendForecast || shouldSendConfirmation) {
        // Import and call notification sender directly (more reliable than HTTP)
        const { sendSnowBanNotifications } = await import('../send-snow-ban-notifications');

        let userNotifyResult = null;
        try {
          userNotifyResult = await sendSnowBanNotifications(notificationType);
          console.log('User notifications sent:', userNotifyResult);
        } catch (notifyError) {
          console.error('User notification failed:', notifyError);
        }

        // Also send push notifications to mobile app users parked on snow routes
        let mobileNotifyResult = null;
        try {
          const { sendMobileSnowBanNotifications } = await import('./mobile-snow-notifications');
          mobileNotifyResult = await sendMobileSnowBanNotifications(
            notificationType,
            snowData.snowAmountInches
          );
          console.log('Mobile notifications sent:', mobileNotifyResult);
        } catch (mobileError) {
          console.error('Mobile notification failed:', mobileError);
        }

        // Also notify admin
        try {
          const { notifyAdminSnow } = await import('../admin/notify-admin-snow');
          await notifyAdminSnow({
            snowAmount: snowData.snowAmountInches,
            forecastPeriod: snowData.forecastPeriod,
            detailedForecast: snowData.detailedForecast,
            eventId: event?.id,
            notificationType,
            userStats: userNotifyResult?.stats
          });
        } catch (adminError) {
          console.error('Admin notification failed:', adminError);
        }

        return res.status(200).json({
          success: true,
          message: `${notificationType} notifications sent`,
          snowCheck: snowCheckResult,
          notificationType,
          userNotifications: userNotifyResult,
          mobileNotifications: mobileNotifyResult,
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
      error: sanitizeErrorMessage(error),
      processingTime: Date.now() - startTime
    });
  }
}
