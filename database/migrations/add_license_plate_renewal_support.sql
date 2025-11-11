-- Add License Plate Renewal Support for Illinois Secretary of State
-- Supports all vehicle types with different renewal fees
-- Remitter will process both city sticker AND license plate renewals

-- Add license plate renewal fields
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS license_plate_renewal_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS license_plate_type TEXT,
ADD COLUMN IF NOT EXISTS license_plate_is_personalized BOOLEAN,
ADD COLUMN IF NOT EXISTS license_plate_is_vanity BOOLEAN,
ADD COLUMN IF NOT EXISTS license_plate_last_accessed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trailer_weight INTEGER, -- For RT (Recreational Trailer) plates
ADD COLUMN IF NOT EXISTS rv_weight INTEGER; -- For RV (Recreational Vehicle) plates

-- Set defaults
ALTER TABLE user_profiles
ALTER COLUMN license_plate_is_personalized SET DEFAULT false,
ALTER COLUMN license_plate_is_vanity SET DEFAULT false;

-- Update existing rows
UPDATE user_profiles
SET license_plate_is_personalized = false
WHERE license_plate_is_personalized IS NULL;

UPDATE user_profiles
SET license_plate_is_vanity = false
WHERE license_plate_is_vanity IS NULL;

-- Function to calculate Illinois license plate renewal cost
CREATE OR REPLACE FUNCTION calculate_plate_renewal_cost(
  plate_type TEXT,
  is_personalized BOOLEAN DEFAULT false,
  is_vanity BOOLEAN DEFAULT false,
  trailer_weight_lbs INTEGER DEFAULT NULL,
  rv_weight_lbs INTEGER DEFAULT NULL
) RETURNS DECIMAL(10,2) AS $$
DECLARE
  base_cost DECIMAL(10,2);
BEGIN
  -- Base costs by plate type (from Illinois Secretary of State)
  CASE UPPER(plate_type)
    WHEN 'PASSENGER' THEN base_cost := 151.00;
    WHEN 'MOTORCYCLE' THEN base_cost := 41.00;
    WHEN 'B-TRUCK' THEN base_cost := 151.00;
    WHEN 'C-TRUCK' THEN base_cost := 218.00;
    WHEN 'PERSONS_WITH_DISABILITIES' THEN base_cost := 151.00;

    -- Recreational Trailers (RT) - weight-based
    WHEN 'RT' THEN
      IF trailer_weight_lbs IS NULL THEN
        base_cost := 18.00; -- Default to lightest
      ELSIF trailer_weight_lbs <= 3000 THEN
        base_cost := 18.00;
      ELSIF trailer_weight_lbs <= 8000 THEN
        base_cost := 30.00;
      ELSIF trailer_weight_lbs <= 10000 THEN
        base_cost := 38.00;
      ELSE
        base_cost := 50.00;
      END IF;

    -- Recreational Vehicles (RV) - weight-based
    WHEN 'RV' THEN
      IF rv_weight_lbs IS NULL THEN
        base_cost := 78.00; -- Default to lightest
      ELSIF rv_weight_lbs <= 8000 THEN
        base_cost := 78.00;
      ELSIF rv_weight_lbs <= 10000 THEN
        base_cost := 90.00;
      ELSE
        base_cost := 102.00;
      END IF;

    ELSE
      base_cost := 151.00; -- Default to standard passenger
  END CASE;

  -- Add personalized fee (+$7)
  IF is_personalized THEN
    base_cost := base_cost + 7.00;
  END IF;

  -- Add vanity fee (+$13 total, or +$6 more than personalized)
  IF is_vanity THEN
    base_cost := base_cost + 13.00;
  END IF;

  RETURN base_cost;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-calculate renewal cost when plate type changes
CREATE OR REPLACE FUNCTION update_plate_renewal_cost()
RETURNS TRIGGER AS $$
BEGIN
  -- Only calculate if plate type is set
  IF NEW.license_plate_type IS NOT NULL THEN
    NEW.license_plate_renewal_cost := calculate_plate_renewal_cost(
      NEW.license_plate_type,
      COALESCE(NEW.license_plate_is_personalized, false),
      COALESCE(NEW.license_plate_is_vanity, false),
      NEW.trailer_weight,
      NEW.rv_weight
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER calculate_plate_cost
  BEFORE INSERT OR UPDATE OF license_plate_type, license_plate_is_personalized,
                             license_plate_is_vanity, trailer_weight, rv_weight
  ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_plate_renewal_cost();

-- Index for cleanup queries (similar to license images)
CREATE INDEX idx_license_plate_last_accessed
ON user_profiles(license_plate_last_accessed_at)
WHERE license_plate_last_accessed_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_profiles.license_plate_renewal_cost IS 'Calculated Illinois license plate renewal cost based on plate type';
COMMENT ON COLUMN user_profiles.license_plate_type IS 'Type of license plate: PASSENGER, MOTORCYCLE, B-TRUCK, C-TRUCK, RT, RV, PERSONS_WITH_DISABILITIES';
COMMENT ON COLUMN user_profiles.license_plate_is_personalized IS 'Personalized plate (+$7 fee)';
COMMENT ON COLUMN user_profiles.license_plate_is_vanity IS 'Vanity plate (+$13 fee)';
COMMENT ON COLUMN user_profiles.license_plate_last_accessed_at IS 'When remitter last accessed plate info for renewal (triggers 48h deletion if opted out)';
COMMENT ON COLUMN user_profiles.trailer_weight IS 'Trailer weight in pounds (for RT plate fee calculation)';
COMMENT ON COLUMN user_profiles.rv_weight IS 'RV weight in pounds (for RV plate fee calculation)';

-- Example usage:
-- SELECT calculate_plate_renewal_cost('PASSENGER', false, false, NULL, NULL); -- $151
-- SELECT calculate_plate_renewal_cost('PASSENGER', true, false, NULL, NULL);  -- $158 (personalized)
-- SELECT calculate_plate_renewal_cost('PASSENGER', false, true, NULL, NULL);  -- $164 (vanity)
-- SELECT calculate_plate_renewal_cost('MOTORCYCLE', false, false, NULL, NULL); -- $41
-- SELECT calculate_plate_renewal_cost('RT', false, false, 5000, NULL); -- $30 (3,001-8,000 lbs)
-- SELECT calculate_plate_renewal_cost('RV', false, false, NULL, 9000); -- $90 (8,001-10,000 lbs)
