-- Add email forwarding for proof of residency via utility bills
-- Format: documents+{user_uuid}@autopilotamerica.com
-- Example: documents+049f3b4a-32d4-4d09-87de-eb0cfe33c04e@autopilotamerica.com

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
CREATE TRIGGER set_email_forwarding_address
  BEFORE INSERT OR UPDATE OF has_protection ON user_profiles
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
