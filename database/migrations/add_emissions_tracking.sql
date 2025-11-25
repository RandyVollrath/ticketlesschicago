-- Migration: Add emissions completion tracking
-- This tracks whether a user has completed their emissions test
-- Required because IL SOS won't process license plate renewal without completed emissions

-- Add emissions_completed field to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS emissions_completed BOOLEAN DEFAULT FALSE;

-- Add emissions_completed_at timestamp to track when they marked it complete
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS emissions_completed_at TIMESTAMPTZ;

-- Add emissions_test_year to track which year's test was completed
-- (emissions tests are every 2 years, so we need to know which cycle)
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS emissions_test_year INTEGER;

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.emissions_completed IS 'Whether user has completed their emissions test for the current cycle';
COMMENT ON COLUMN public.user_profiles.emissions_completed_at IS 'When user confirmed emissions test completion';
COMMENT ON COLUMN public.user_profiles.emissions_test_year IS 'Year of the emissions test cycle (biennial)';

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_emissions_completed
ON public.user_profiles(emissions_completed)
WHERE emissions_date IS NOT NULL;

-- Create a function to check if emissions blocks license plate renewal
-- Returns true if:
-- 1. User has an emissions_date set (meaning they need emissions testing)
-- 2. Emissions is NOT completed
-- 3. License plate renewal is due within 60 days
CREATE OR REPLACE FUNCTION check_emissions_blocks_renewal(user_uuid UUID)
RETURNS BOOLEAN AS $$
DECLARE
  user_record RECORD;
  days_until_plate_expiry INTEGER;
  days_until_emissions_due INTEGER;
BEGIN
  SELECT
    emissions_date,
    emissions_completed,
    license_plate_expiry
  INTO user_record
  FROM public.user_profiles
  WHERE user_id = user_uuid;

  -- If no emissions date set, emissions doesn't block
  IF user_record.emissions_date IS NULL THEN
    RETURN FALSE;
  END IF;

  -- If emissions already completed, it doesn't block
  IF user_record.emissions_completed = TRUE THEN
    RETURN FALSE;
  END IF;

  -- If no license plate expiry set, nothing to block
  IF user_record.license_plate_expiry IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Calculate days until each
  days_until_plate_expiry := user_record.license_plate_expiry - CURRENT_DATE;
  days_until_emissions_due := user_record.emissions_date - CURRENT_DATE;

  -- Emissions blocks renewal if:
  -- 1. License plate expires within 60 days
  -- 2. Emissions is due within same window (or already past due but not completed)
  IF days_until_plate_expiry <= 60 AND days_until_emissions_due <= 60 THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Create a view for users needing urgent emissions reminders
-- These are users where emissions could block their license plate renewal
CREATE OR REPLACE VIEW v_emissions_blocking_renewals AS
SELECT
  up.user_id,
  up.email,
  up.phone_number,
  up.emissions_date,
  up.emissions_completed,
  up.license_plate_expiry,
  up.has_protection,
  up.license_plate,
  (up.license_plate_expiry - CURRENT_DATE) as days_until_plate_expiry,
  (up.emissions_date - CURRENT_DATE) as days_until_emissions_due,
  CASE
    WHEN (up.license_plate_expiry - CURRENT_DATE) <= 30 THEN 'CRITICAL'
    WHEN (up.license_plate_expiry - CURRENT_DATE) <= 45 THEN 'URGENT'
    WHEN (up.license_plate_expiry - CURRENT_DATE) <= 60 THEN 'WARNING'
    ELSE 'OK'
  END as urgency_level
FROM public.user_profiles up
WHERE
  up.emissions_date IS NOT NULL
  AND (up.emissions_completed = FALSE OR up.emissions_completed IS NULL)
  AND up.license_plate_expiry IS NOT NULL
  AND (up.license_plate_expiry - CURRENT_DATE) <= 60
  AND (up.emissions_date - CURRENT_DATE) <= 60;

COMMENT ON VIEW v_emissions_blocking_renewals IS 'Users whose incomplete emissions test could block their license plate renewal';
