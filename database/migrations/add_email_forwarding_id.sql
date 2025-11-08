-- Add email forwarding for proof of residency via utility bills
-- Format: documents+{user_uuid}@autopilotamerica.com
-- Example: documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com

ALTER TABLE user_profiles
ADD COLUMN email_forwarding_address TEXT,
ADD COLUMN residency_proof_path TEXT,
ADD COLUMN residency_proof_uploaded_at TIMESTAMPTZ,
ADD COLUMN residency_proof_verified BOOLEAN DEFAULT false,
ADD COLUMN residency_proof_verified_at TIMESTAMPTZ,
ADD COLUMN residency_forwarding_enabled BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_consent_given BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_consent_given_at TIMESTAMPTZ,
ADD COLUMN city_sticker_purchase_confirmed_at TIMESTAMPTZ;

-- Function to generate email forwarding address using user UUID
CREATE OR REPLACE FUNCTION generate_email_forwarding_address()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate if user has protection + permit zone + hasn't already been assigned
  IF NEW.has_protection = true
     AND NEW.has_permit_zone = true
     AND NEW.email_forwarding_address IS NULL
  THEN
    NEW.email_forwarding_address := 'documents+' || NEW.user_id || '@autopilotamerica.com';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate email forwarding address when user signs up for protection + permit
CREATE TRIGGER set_email_forwarding_address
  BEFORE INSERT OR UPDATE OF has_protection, has_permit_zone ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_email_forwarding_address();

-- Index for cleanup of old residency proofs
CREATE INDEX idx_residency_proof_cleanup
ON user_profiles(residency_proof_uploaded_at)
WHERE residency_proof_path IS NOT NULL;

-- Index for finding users with confirmed purchases (for cleanup)
CREATE INDEX idx_city_sticker_purchase_confirmed
ON user_profiles(city_sticker_purchase_confirmed_at)
WHERE city_sticker_purchase_confirmed_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_profiles.email_forwarding_address IS 'Email forwarding address for utility bills using user UUID (documents+{uuid}@autopilotamerica.com)';
COMMENT ON COLUMN user_profiles.residency_proof_path IS 'Path to most recent utility bill (proof of residency) - deleted after purchase confirmed or 60 days outside renewal window';
COMMENT ON COLUMN user_profiles.residency_forwarding_enabled IS 'User has set up email forwarding from utility provider';
COMMENT ON COLUMN user_profiles.residency_forwarding_consent_given IS 'User consents to automated processing of forwarded utility bills';
COMMENT ON COLUMN user_profiles.city_sticker_purchase_confirmed_at IS 'Timestamp when city confirmed successful city sticker purchase (triggers residency proof deletion)';
