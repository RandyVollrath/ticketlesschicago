-- ============================================================================
-- COMPLETE DATABASE MIGRATIONS
-- Run this entire file to add all new features
-- Safe to run multiple times (has DROP IF EXISTS)
-- ============================================================================

-- ============================================================================
-- MIGRATION 1: Email Forwarding & Residency Proofs
-- ============================================================================

-- Add columns without defaults first
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email_forwarding_address TEXT,
ADD COLUMN IF NOT EXISTS residency_proof_path TEXT,
ADD COLUMN IF NOT EXISTS residency_proof_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS residency_proof_verified BOOLEAN,
ADD COLUMN IF NOT EXISTS residency_proof_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS residency_forwarding_enabled BOOLEAN,
ADD COLUMN IF NOT EXISTS residency_forwarding_consent_given BOOLEAN,
ADD COLUMN IF NOT EXISTS residency_forwarding_consent_given_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS city_sticker_purchase_confirmed_at TIMESTAMPTZ;

-- Set defaults separately
ALTER TABLE user_profiles
ALTER COLUMN residency_proof_verified SET DEFAULT false,
ALTER COLUMN residency_forwarding_enabled SET DEFAULT false,
ALTER COLUMN residency_forwarding_consent_given SET DEFAULT false;

-- Update existing rows
UPDATE user_profiles
SET residency_proof_verified = false
WHERE residency_proof_verified IS NULL;

UPDATE user_profiles
SET residency_forwarding_enabled = false
WHERE residency_forwarding_enabled IS NULL;

UPDATE user_profiles
SET residency_forwarding_consent_given = false
WHERE residency_forwarding_consent_given IS NULL;

-- Function to generate email forwarding address using user UUID
CREATE OR REPLACE FUNCTION generate_email_forwarding_address()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate email forwarding address for all protection users
  -- (permit zone check happens at UI level)
  IF NEW.has_protection = true
     AND NEW.email_forwarding_address IS NULL
  THEN
    NEW.email_forwarding_address := 'documents+' || NEW.user_id || '@autopilotamerica.com';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate email forwarding address when user signs up for protection
DROP TRIGGER IF EXISTS set_email_forwarding_address ON user_profiles;

CREATE TRIGGER set_email_forwarding_address
  BEFORE INSERT OR UPDATE OF has_protection ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_email_forwarding_address();

-- Index for cleanup of old residency proofs
DROP INDEX IF EXISTS idx_residency_proof_cleanup;
CREATE INDEX idx_residency_proof_cleanup
ON user_profiles(residency_proof_uploaded_at)
WHERE residency_proof_path IS NOT NULL;

-- Index for finding users with confirmed purchases (for cleanup)
DROP INDEX IF EXISTS idx_city_sticker_purchase_confirmed;
CREATE INDEX idx_city_sticker_purchase_confirmed
ON user_profiles(city_sticker_purchase_confirmed_at)
WHERE city_sticker_purchase_confirmed_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_profiles.email_forwarding_address IS 'Email forwarding address for utility bills using user UUID (documents+{uuid}@autopilotamerica.com)';
COMMENT ON COLUMN user_profiles.residency_proof_path IS 'Path to most recent utility bill (proof of residency) - deleted after 31 days';
COMMENT ON COLUMN user_profiles.residency_forwarding_enabled IS 'User has set up email forwarding from utility provider';
COMMENT ON COLUMN user_profiles.residency_forwarding_consent_given IS 'User consents to automated processing of forwarded utility bills';
COMMENT ON COLUMN user_profiles.city_sticker_purchase_confirmed_at IS 'Timestamp when city confirmed successful city sticker purchase';

-- ============================================================================
-- MIGRATION 2: License Plate Renewal Support
-- ============================================================================

-- Add license plate renewal fields
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS license_plate_renewal_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS license_plate_type TEXT,
ADD COLUMN IF NOT EXISTS license_plate_is_personalized BOOLEAN,
ADD COLUMN IF NOT EXISTS license_plate_is_vanity BOOLEAN,
ADD COLUMN IF NOT EXISTS license_plate_last_accessed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trailer_weight INTEGER,
ADD COLUMN IF NOT EXISTS rv_weight INTEGER;

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
        base_cost := 18.00;
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
        base_cost := 78.00;
      ELSIF rv_weight_lbs <= 8000 THEN
        base_cost := 78.00;
      ELSIF rv_weight_lbs <= 10000 THEN
        base_cost := 90.00;
      ELSE
        base_cost := 102.00;
      END IF;

    ELSE
      base_cost := 151.00;
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

DROP TRIGGER IF EXISTS calculate_plate_cost ON user_profiles;

CREATE TRIGGER calculate_plate_cost
  BEFORE INSERT OR UPDATE OF license_plate_type, license_plate_is_personalized,
                             license_plate_is_vanity, trailer_weight, rv_weight
  ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_plate_renewal_cost();

-- Index for cleanup queries
DROP INDEX IF EXISTS idx_license_plate_last_accessed;
CREATE INDEX idx_license_plate_last_accessed
ON user_profiles(license_plate_last_accessed_at)
WHERE license_plate_last_accessed_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_profiles.license_plate_renewal_cost IS 'Calculated Illinois license plate renewal cost based on plate type';
COMMENT ON COLUMN user_profiles.license_plate_type IS 'Type of license plate: PASSENGER, MOTORCYCLE, B-TRUCK, C-TRUCK, RT, RV, PERSONS_WITH_DISABILITIES';
COMMENT ON COLUMN user_profiles.license_plate_is_personalized IS 'Personalized plate (+$7 fee)';
COMMENT ON COLUMN user_profiles.license_plate_is_vanity IS 'Vanity plate (+$13 fee)';
COMMENT ON COLUMN user_profiles.license_plate_last_accessed_at IS 'When remitter last accessed plate info for renewal';
COMMENT ON COLUMN user_profiles.trailer_weight IS 'Trailer weight in pounds (for RT plate fee calculation)';
COMMENT ON COLUMN user_profiles.rv_weight IS 'RV weight in pounds (for RV plate fee calculation)';

-- ============================================================================
-- MIGRATION 3: License Access Audit Log
-- ============================================================================

-- Create audit log table
CREATE TABLE IF NOT EXISTS license_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_by TEXT NOT NULL, -- 'remitter_automation', 'support_staff', 'user_self', etc.
  reason TEXT NOT NULL, -- 'city_sticker_renewal', 'support_request', 'user_download', etc.
  ip_address TEXT,
  user_agent TEXT,
  license_image_path TEXT, -- Which file was accessed
  request_id TEXT, -- Optional: for correlating with application logs
  metadata JSONB -- Additional context (e.g., { "renewal_type": "city_sticker", "remitter_id": "xyz" })
);

-- Indexes for fast querying
DROP INDEX IF EXISTS idx_license_access_log_user_id;
DROP INDEX IF EXISTS idx_license_access_log_accessed_at;
DROP INDEX IF EXISTS idx_license_access_log_accessed_by;
DROP INDEX IF EXISTS idx_license_access_log_reason;

CREATE INDEX idx_license_access_log_user_id ON license_access_log(user_id);
CREATE INDEX idx_license_access_log_accessed_at ON license_access_log(accessed_at DESC);
CREATE INDEX idx_license_access_log_accessed_by ON license_access_log(accessed_by);
CREATE INDEX idx_license_access_log_reason ON license_access_log(reason);

-- Enable Row Level Security
ALTER TABLE license_access_log ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own access logs" ON license_access_log;
DROP POLICY IF EXISTS "Service role can manage all logs" ON license_access_log;

-- Policy: Users can only see their own access logs
CREATE POLICY "Users can view their own access logs"
  ON license_access_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can insert/view all logs
CREATE POLICY "Service role can manage all logs"
  ON license_access_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- Function to get user's recent access history
CREATE OR REPLACE FUNCTION get_license_access_history(target_user_id UUID, limit_count INT DEFAULT 10)
RETURNS TABLE (
  accessed_at TIMESTAMPTZ,
  accessed_by TEXT,
  reason TEXT,
  days_ago INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.accessed_at,
    l.accessed_by,
    l.reason,
    EXTRACT(DAY FROM NOW() - l.accessed_at)::INT as days_ago
  FROM license_access_log l
  WHERE l.user_id = target_user_id
  ORDER BY l.accessed_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to detect unusual access patterns
CREATE OR REPLACE FUNCTION detect_unusual_license_access(target_user_id UUID)
RETURNS TABLE (
  alert_type TEXT,
  alert_message TEXT,
  access_count INT
) AS $$
DECLARE
  access_count_24h INT;
  access_count_7d INT;
  last_access_reason TEXT;
BEGIN
  -- Count accesses in last 24 hours
  SELECT COUNT(*) INTO access_count_24h
  FROM license_access_log
  WHERE user_id = target_user_id
    AND accessed_at > NOW() - INTERVAL '24 hours';

  -- Count accesses in last 7 days
  SELECT COUNT(*) INTO access_count_7d
  FROM license_access_log
  WHERE user_id = target_user_id
    AND accessed_at > NOW() - INTERVAL '7 days';

  -- Get last access reason
  SELECT reason INTO last_access_reason
  FROM license_access_log
  WHERE user_id = target_user_id
  ORDER BY accessed_at DESC
  LIMIT 1;

  -- Alert if more than 3 accesses in 24 hours
  IF access_count_24h > 3 THEN
    RETURN QUERY SELECT
      'high_frequency_24h'::TEXT,
      format('License accessed %s times in last 24 hours', access_count_24h),
      access_count_24h;
  END IF;

  -- Alert if more than 5 accesses in 7 days (renewals are ~yearly, so this is unusual)
  IF access_count_7d > 5 THEN
    RETURN QUERY SELECT
      'high_frequency_7d'::TEXT,
      format('License accessed %s times in last 7 days', access_count_7d),
      access_count_7d;
  END IF;

  -- If no alerts, return null
  IF access_count_24h <= 3 AND access_count_7d <= 5 THEN
    RETURN QUERY SELECT
      'normal'::TEXT,
      'Access pattern is normal'::TEXT,
      access_count_7d;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE license_access_log IS 'Audit log for all driver license image accesses - provides transparency and security monitoring';
COMMENT ON COLUMN license_access_log.accessed_by IS 'Who accessed: remitter_automation, support_staff, user_self, admin_debug';
COMMENT ON COLUMN license_access_log.reason IS 'Why accessed: city_sticker_renewal, license_plate_renewal, support_request, user_download, verification';
COMMENT ON COLUMN license_access_log.metadata IS 'Additional context in JSON format';

-- ============================================================================
-- DONE! All migrations complete
-- ============================================================================

-- Test queries you can run:
--
-- Get user's access history:
-- SELECT * FROM get_license_access_history('user-uuid', 10);
--
-- Check for unusual access:
-- SELECT * FROM detect_unusual_license_access('user-uuid');
--
-- Test license plate cost calculation:
-- SELECT calculate_plate_renewal_cost('PASSENGER', false, false, NULL, NULL); -- Should return 151.00
-- SELECT calculate_plate_renewal_cost('MOTORCYCLE', true, false, NULL, NULL); -- Should return 48.00 (41 + 7)
-- SELECT calculate_plate_renewal_cost('PASSENGER', false, true, NULL, NULL); -- Should return 164.00 (151 + 13)
