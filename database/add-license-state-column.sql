-- Add license_state column to user_profiles table for towing alerts
-- Default to 'IL' for existing Chicago users

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS license_state TEXT DEFAULT 'IL';

-- Create index for plate + state lookups (used by towing alerts)
CREATE INDEX IF NOT EXISTS idx_user_license_plate_state
ON user_profiles(license_plate, license_state);
