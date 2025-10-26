-- Snow Route Status Tracking Table
-- Tracks the current status of Chicago's 2-inch snow ban
-- This is a single-row table that stores the current state

CREATE TABLE IF NOT EXISTS public.snow_route_status (
  id INTEGER PRIMARY KEY DEFAULT 1, -- Only allow one row
  is_active BOOLEAN DEFAULT false,
  activation_date TIMESTAMPTZ,
  deactivation_date TIMESTAMPTZ,
  snow_amount_inches DECIMAL(4,2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure only one row exists
  CONSTRAINT single_row_check CHECK (id = 1)
);

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_snow_route_status_active ON public.snow_route_status(is_active);

-- Insert initial row
INSERT INTO public.snow_route_status (id, is_active, notes)
VALUES (1, false, 'Snow route status tracking initialized')
ON CONFLICT (id) DO NOTHING;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to activate the snow ban
CREATE OR REPLACE FUNCTION activate_snow_ban(
  p_snow_amount DECIMAL DEFAULT 2.0,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.snow_route_status
  SET
    is_active = true,
    activation_date = NOW(),
    deactivation_date = NULL,
    snow_amount_inches = p_snow_amount,
    notes = COALESCE(p_notes, 'Snow ban activated'),
    updated_at = NOW()
  WHERE id = 1;

  -- Log the activation
  RAISE NOTICE 'Snow ban activated with % inches of snow', p_snow_amount;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to deactivate the snow ban
CREATE OR REPLACE FUNCTION deactivate_snow_ban(
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE public.snow_route_status
  SET
    is_active = false,
    deactivation_date = NOW(),
    notes = COALESCE(p_notes, 'Snow ban deactivated'),
    updated_at = NOW()
  WHERE id = 1;

  -- Log the deactivation
  RAISE NOTICE 'Snow ban deactivated';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if we're in winter ban hours (3am-7am)
CREATE OR REPLACE FUNCTION is_winter_ban_hours()
RETURNS BOOLEAN AS $$
DECLARE
  chicago_time TIMESTAMPTZ;
  hour_of_day INTEGER;
BEGIN
  -- Get current time in Chicago timezone
  chicago_time := NOW() AT TIME ZONE 'America/Chicago';
  hour_of_day := EXTRACT(HOUR FROM chicago_time)::INTEGER;

  -- Winter ban is 3am-7am (hours 3, 4, 5, 6)
  RETURN hour_of_day >= 3 AND hour_of_day < 7;
END;
$$ LANGUAGE plpgsql;

-- Function to get current snow ban status with timing info
CREATE OR REPLACE FUNCTION get_snow_ban_status()
RETURNS TABLE (
  is_active BOOLEAN,
  is_winter_ban_hours BOOLEAN,
  activation_date TIMESTAMPTZ,
  snow_amount_inches DECIMAL,
  severity TEXT,
  hours_until_winter_ban INTEGER
) AS $$
DECLARE
  chicago_time TIMESTAMPTZ;
  current_hour INTEGER;
  hours_until_3am INTEGER;
BEGIN
  chicago_time := NOW() AT TIME ZONE 'America/Chicago';
  current_hour := EXTRACT(HOUR FROM chicago_time)::INTEGER;

  -- Calculate hours until next 3am
  IF current_hour < 3 THEN
    hours_until_3am := 3 - current_hour;
  ELSE
    hours_until_3am := 24 - current_hour + 3;
  END IF;

  RETURN QUERY
  SELECT
    srs.is_active,
    is_winter_ban_hours() as is_winter_ban_hours,
    srs.activation_date,
    srs.snow_amount_inches,
    CASE
      WHEN srs.is_active AND is_winter_ban_hours() THEN 'critical'::TEXT
      WHEN srs.is_active AND NOT is_winter_ban_hours() THEN 'warning'::TEXT
      ELSE 'info'::TEXT
    END as severity,
    hours_until_3am
  FROM public.snow_route_status srs
  WHERE srs.id = 1;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.snow_route_status ENABLE ROW LEVEL SECURITY;

-- Allow public read access
DROP POLICY IF EXISTS "Anyone can view snow route status" ON public.snow_route_status;
CREATE POLICY "Anyone can view snow route status"
  ON public.snow_route_status
  FOR SELECT USING (true);

-- =====================================================
-- GRANTS
-- =====================================================
GRANT SELECT ON public.snow_route_status TO anon, authenticated;
GRANT EXECUTE ON FUNCTION activate_snow_ban TO authenticated;
GRANT EXECUTE ON FUNCTION deactivate_snow_ban TO authenticated;
GRANT EXECUTE ON FUNCTION is_winter_ban_hours TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_snow_ban_status TO anon, authenticated;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
-- Usage:
--   SELECT activate_snow_ban(2.5, 'Heavy snowfall detected');
--   SELECT deactivate_snow_ban('Streets cleared');
--   SELECT * FROM get_snow_ban_status();
