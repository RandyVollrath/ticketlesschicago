-- Add property tax admin tracking for homeowners
-- Admin fetches property tax bills from Cook County for homeowners annually
-- This enables fully hands-off residency proof for homeowners

-- Track when admin last fetched property tax bill
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS property_tax_last_fetched_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS property_tax_needs_refresh BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS property_tax_fetch_failed BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS property_tax_fetch_notes TEXT;

-- Set defaults
ALTER TABLE user_profiles
ALTER COLUMN property_tax_needs_refresh SET DEFAULT false,
ALTER COLUMN property_tax_fetch_failed SET DEFAULT false;

-- Update existing rows
UPDATE user_profiles
SET property_tax_needs_refresh = false
WHERE property_tax_needs_refresh IS NULL;

UPDATE user_profiles
SET property_tax_fetch_failed = false
WHERE property_tax_fetch_failed IS NULL;

-- Index for finding users who need property tax refresh
CREATE INDEX IF NOT EXISTS idx_property_tax_needs_refresh
ON user_profiles(property_tax_needs_refresh)
WHERE property_tax_needs_refresh = true
  AND residency_proof_type = 'property_tax';

-- Index for finding homeowners with property tax proof type
CREATE INDEX IF NOT EXISTS idx_residency_proof_type
ON user_profiles(residency_proof_type)
WHERE residency_proof_type IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_profiles.property_tax_last_fetched_at IS 'When admin last fetched property tax bill from Cook County for this user';
COMMENT ON COLUMN user_profiles.property_tax_needs_refresh IS 'Flag set by cron job in July when property tax bills need refreshing';
COMMENT ON COLUMN user_profiles.property_tax_fetch_failed IS 'Admin could not find property tax bill for this address';
COMMENT ON COLUMN user_profiles.property_tax_fetch_notes IS 'Admin notes about property tax fetch (e.g., address not found, name mismatch)';
