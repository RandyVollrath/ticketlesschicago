-- Add granular notification preferences for 2-inch snow ban alerts
-- Users can opt in/out of forecast vs confirmation alerts
-- Users can choose email, SMS, or both for snow alerts

ALTER TABLE public.user_profiles
  -- Forecast notification preferences (when 2+ inches predicted)
  ADD COLUMN IF NOT EXISTS notify_snow_forecast BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notify_snow_forecast_email BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_snow_forecast_sms BOOLEAN DEFAULT TRUE,

  -- Confirmation notification preferences (when 2+ inches has fallen)
  ADD COLUMN IF NOT EXISTS notify_snow_confirmation BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notify_snow_confirmation_email BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS notify_snow_confirmation_sms BOOLEAN DEFAULT TRUE,

  -- Track if user's address is on a snow route
  ADD COLUMN IF NOT EXISTS on_snow_route BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS snow_route_street VARCHAR(255);

-- Add comments
COMMENT ON COLUMN public.user_profiles.notify_snow_forecast IS 'Opt-in for forecast alerts when 2+ inches predicted';
COMMENT ON COLUMN public.user_profiles.notify_snow_forecast_email IS 'Receive forecast alerts via email';
COMMENT ON COLUMN public.user_profiles.notify_snow_forecast_sms IS 'Receive forecast alerts via SMS';
COMMENT ON COLUMN public.user_profiles.notify_snow_confirmation IS 'Receive confirmation alerts when 2+ inches has fallen (auto-enabled for snow route addresses)';
COMMENT ON COLUMN public.user_profiles.notify_snow_confirmation_email IS 'Receive confirmation alerts via email';
COMMENT ON COLUMN public.user_profiles.notify_snow_confirmation_sms IS 'Receive confirmation alerts via SMS';
COMMENT ON COLUMN public.user_profiles.on_snow_route IS 'Whether user address is on a 2-inch snow ban route';
COMMENT ON COLUMN public.user_profiles.snow_route_street IS 'The snow route street name if on a route';

-- Create index for efficient snow route lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_on_snow_route
  ON public.user_profiles(on_snow_route)
  WHERE on_snow_route = TRUE;
