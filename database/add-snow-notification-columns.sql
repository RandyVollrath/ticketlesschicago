-- Add columns to support forecast vs confirmation notifications

-- Add forecast tracking columns to snow_events table
ALTER TABLE public.snow_events
  ADD COLUMN IF NOT EXISTS forecast_sent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS forecast_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.snow_events.forecast_sent IS 'Whether forecast notification (2+ inches predicted) has been sent';
COMMENT ON COLUMN public.snow_events.forecast_sent_at IS 'When the forecast notification was sent';

-- Add notification_type column to user_snow_ban_notifications table
ALTER TABLE public.user_snow_ban_notifications
  ADD COLUMN IF NOT EXISTS notification_type VARCHAR(20) DEFAULT 'confirmation';

COMMENT ON COLUMN public.user_snow_ban_notifications.notification_type IS 'Type of notification: "forecast" (predicted) or "confirmation" (fallen)';

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_snow_notifications_type
  ON public.user_snow_ban_notifications(user_id, snow_event_id, notification_type);
