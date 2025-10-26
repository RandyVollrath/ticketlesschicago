import type { NextApiRequest, NextApiResponse } from 'next';
import { checkForSnow } from '../../../lib/weather-service';
import { supabaseAdmin } from '../../../lib/supabase';

/**
 * API endpoint to check current snow conditions
 * This can be called manually or by a cron job
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check weather for snow
    const snowData = await checkForSnow();

    console.log('Snow check results:', snowData);

    // If snow >= 2 inches, record it in the database
    if (snowData.snowAmountInches >= 2.0) {
      const today = new Date().toISOString().split('T')[0];

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

          // Auto-activate snow route status for mobile app
          const { error: activateError } = await supabaseAdmin.rpc('activate_snow_ban', {
            p_snow_amount: snowData.snowAmountInches,
            p_notes: `Auto-activated by weather monitoring - ${snowData.snowAmountInches}" forecasted`
          });

          if (activateError) {
            console.error('Error activating snow ban:', activateError);
          } else {
            console.log('Snow route status activated for mobile app');
          }
        }

        return res.status(200).json({
          success: true,
          snowDetected: true,
          twoInchBanTriggered: false,
          needsNotification: true,
          event: newEvent,
          snowData
        });
      } else {
        // Update existing event with latest data
        const { error: updateError } = await supabaseAdmin
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

        if (updateError) {
          console.error('Error updating snow event:', updateError);
        } else {
          // Ensure snow route status is activated
          const { error: activateError } = await supabaseAdmin.rpc('activate_snow_ban', {
            p_snow_amount: Math.max(existingEvent.snow_amount_inches, snowData.snowAmountInches),
            p_notes: `Auto-updated by weather monitoring - ${snowData.snowAmountInches}" detected`
          });

          if (activateError) {
            console.error('Error activating snow ban:', activateError);
          }
        }

        return res.status(200).json({
          success: true,
          snowDetected: true,
          twoInchBanTriggered: existingEvent.two_inch_ban_triggered,
          needsNotification: !existingEvent.two_inch_ban_triggered,
          event: existingEvent,
          snowData
        });
      }
    }

    // No significant snow
    return res.status(200).json({
      success: true,
      snowDetected: snowData.hasSnow,
      twoInchBanTriggered: false,
      needsNotification: false,
      snowData
    });

  } catch (error) {
    console.error('Error checking snow:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check snow conditions',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
