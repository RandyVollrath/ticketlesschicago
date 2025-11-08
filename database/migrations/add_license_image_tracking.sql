-- Add license image tracking to user_profiles
-- Images are stored temporarily in Supabase Storage and deleted after verification

ALTER TABLE user_profiles
ADD COLUMN license_image_path TEXT,
ADD COLUMN license_image_uploaded_at TIMESTAMPTZ,
ADD COLUMN license_image_verified BOOLEAN DEFAULT false,
ADD COLUMN license_image_verified_at TIMESTAMPTZ,
ADD COLUMN license_image_verified_by TEXT,
ADD COLUMN license_image_verification_notes TEXT;

-- Create index for cleanup job (find old unverified images)
CREATE INDEX idx_license_image_cleanup
ON user_profiles(license_image_uploaded_at)
WHERE license_image_path IS NOT NULL AND license_image_verified = false;

-- Create index for verification workflow
CREATE INDEX idx_license_image_unverified
ON user_profiles(license_image_verified, license_image_uploaded_at)
WHERE license_image_path IS NOT NULL;

COMMENT ON COLUMN user_profiles.license_image_path IS 'Temporary storage path in Supabase Storage (auto-deleted after verification or 48 hours)';
COMMENT ON COLUMN user_profiles.license_image_verified IS 'Whether image is clear enough for city clerk processing';
COMMENT ON COLUMN user_profiles.license_image_verification_notes IS 'Reasons if image rejected (e.g., "blurry", "incomplete", "glare")';
