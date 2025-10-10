-- Migration: Add snow event tracking and 2-inch snow ban notifications
-- Date: 2025-10-08

-- =====================================================
-- 1. SNOW EVENTS TABLE
-- =====================================================
-- Tracks detected snow events in Chicago
CREATE TABLE IF NOT EXISTS public.snow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_date DATE NOT NULL,
  detected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  snow_amount_inches DECIMAL(4,2), -- e.g., 2.50 for 2.5 inches
  forecast_source TEXT DEFAULT 'nws', -- 'nws', 'noaa', 'manual'
  is_active BOOLEAN DEFAULT true, -- Still snowing/fresh snow on ground
  two_inch_ban_triggered BOOLEAN DEFAULT false, -- Whether we triggered the 2-inch ban
  ban_triggered_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB, -- Store raw weather API response
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS snow_events_date_idx ON public.snow_events(event_date);
CREATE INDEX IF NOT EXISTS snow_events_active_idx ON public.snow_events(is_active);
CREATE INDEX IF NOT EXISTS snow_events_ban_triggered_idx ON public.snow_events(two_inch_ban_triggered);

-- =====================================================
-- 2. USER SNOW BAN NOTIFICATIONS TABLE
-- =====================================================
-- Tracks notifications sent for 2-inch snow ban events
CREATE TABLE IF NOT EXISTS public.user_snow_ban_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  snow_event_id UUID REFERENCES public.snow_events(id),
  notification_date DATE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  channels TEXT[], -- ['email', 'sms']
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, snow_event_id) -- One notification per user per snow event
);

-- Create indexes
CREATE INDEX IF NOT EXISTS user_snow_ban_notifications_user_idx ON public.user_snow_ban_notifications(user_id);
CREATE INDEX IF NOT EXISTS user_snow_ban_notifications_event_idx ON public.user_snow_ban_notifications(snow_event_id);
CREATE INDEX IF NOT EXISTS user_snow_ban_notifications_date_idx ON public.user_snow_ban_notifications(notification_date);

-- =====================================================
-- 3. ADD SNOW BAN PREFERENCE TO USER_PROFILES
-- =====================================================
-- Add field to track if user wants 2-inch snow ban notifications
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS notify_snow_ban BOOLEAN DEFAULT false;

-- =====================================================
-- 4. HELPER FUNCTIONS
-- =====================================================

-- Function to get the most recent active snow event
CREATE OR REPLACE FUNCTION public.get_active_snow_event()
RETURNS TABLE (
  id UUID,
  event_date DATE,
  snow_amount_inches DECIMAL(4,2),
  two_inch_ban_triggered BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.event_date,
    s.snow_amount_inches,
    s.two_inch_ban_triggered
  FROM public.snow_events s
  WHERE s.is_active = true
    AND s.snow_amount_inches >= 2.0
    AND s.event_date >= CURRENT_DATE - INTERVAL '7 days'
  ORDER BY s.event_date DESC, s.created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to check if 2-inch ban should be triggered
CREATE OR REPLACE FUNCTION public.should_trigger_two_inch_ban()
RETURNS BOOLEAN AS $$
DECLARE
  v_active_event RECORD;
BEGIN
  -- Get the most recent active snow event
  SELECT * INTO v_active_event FROM public.get_active_snow_event();

  -- Trigger ban if:
  -- 1. There's an active snow event
  -- 2. Snow is >= 2 inches
  -- 3. Ban hasn't been triggered yet for this event
  IF v_active_event.id IS NOT NULL
     AND v_active_event.snow_amount_inches >= 2.0
     AND v_active_event.two_inch_ban_triggered = false THEN
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to mark snow event ban as triggered
CREATE OR REPLACE FUNCTION public.mark_snow_ban_triggered(p_event_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE public.snow_events
  SET
    two_inch_ban_triggered = true,
    ban_triggered_at = NOW(),
    updated_at = NOW()
  WHERE id = p_event_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 5. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.snow_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_snow_ban_notifications ENABLE ROW LEVEL SECURITY;

-- Snow events - public read
DROP POLICY IF EXISTS "Anyone can view snow events" ON public.snow_events;
CREATE POLICY "Anyone can view snow events"
  ON public.snow_events
  FOR SELECT USING (true);

-- User notifications - users view their own
DROP POLICY IF EXISTS "Users view own snow ban notifications" ON public.user_snow_ban_notifications;
CREATE POLICY "Users view own snow ban notifications"
  ON public.user_snow_ban_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- =====================================================
-- 6. GRANTS
-- =====================================================
GRANT SELECT ON public.snow_events TO anon, authenticated;
GRANT SELECT ON public.user_snow_ban_notifications TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_active_snow_event TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.should_trigger_two_inch_ban TO anon, authenticated;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
