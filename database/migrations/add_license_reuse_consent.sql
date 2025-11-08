-- Add multi-year license reuse permission and third-party processing consent

ALTER TABLE user_profiles
ADD COLUMN license_reuse_consent_given BOOLEAN DEFAULT true,
ADD COLUMN license_reuse_consent_given_at TIMESTAMPTZ,
ADD COLUMN license_valid_until DATE,
ADD COLUMN license_last_accessed_at TIMESTAMPTZ,
ADD COLUMN third_party_processing_consent BOOLEAN DEFAULT false,
ADD COLUMN third_party_processing_consent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.license_reuse_consent_given IS 'User consents to reusing their license image for multiple years of city sticker renewals (DEFAULT true - opt-out model)';
COMMENT ON COLUMN user_profiles.license_valid_until IS 'Expiration date of driver license (to know when to request new image)';
COMMENT ON COLUMN user_profiles.license_last_accessed_at IS 'Last time license was accessed for city sticker renewal (for 48-hour deletion window)';
COMMENT ON COLUMN user_profiles.third_party_processing_consent IS 'User consents to Google Cloud Vision processing their license for quality verification';

-- Index for finding licenses expiring soon (need new upload)
CREATE INDEX idx_license_expiring_soon
ON user_profiles(license_valid_until)
WHERE license_reuse_consent_given = true AND license_valid_until IS NOT NULL;
