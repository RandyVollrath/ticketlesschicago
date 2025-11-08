-- Add unique email forwarding ID for proof of residency via email forwarding
-- Format: documents+{forwarding_id}@autopilotamerica.com

-- Create sequence for 5-digit forwarding IDs (10000-99999)
CREATE SEQUENCE IF NOT EXISTS forwarding_id_seq
  START WITH 10000
  INCREMENT BY 1
  MINVALUE 10000
  MAXVALUE 99999
  CYCLE;

-- Add columns for email forwarding and proof of residency
ALTER TABLE user_profiles
ADD COLUMN email_forwarding_id INTEGER UNIQUE,
ADD COLUMN email_forwarding_address TEXT,
ADD COLUMN residency_proof_path TEXT,
ADD COLUMN residency_proof_uploaded_at TIMESTAMPTZ,
ADD COLUMN residency_proof_verified BOOLEAN DEFAULT false,
ADD COLUMN residency_proof_verified_at TIMESTAMPTZ,
ADD COLUMN residency_forwarding_enabled BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_consent_given BOOLEAN DEFAULT false,
ADD COLUMN residency_forwarding_consent_given_at TIMESTAMPTZ;

-- Function to generate email forwarding ID
CREATE OR REPLACE FUNCTION generate_email_forwarding_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Only generate if user has protection + permit zone + hasn't already been assigned
  IF NEW.has_protection = true
     AND NEW.has_permit_zone = true
     AND NEW.email_forwarding_id IS NULL
  THEN
    NEW.email_forwarding_id := nextval('forwarding_id_seq');
    NEW.email_forwarding_address := 'documents+' || NEW.email_forwarding_id || '@autopilotamerica.com';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate email forwarding ID when user signs up for protection + permit
CREATE TRIGGER set_email_forwarding_id
  BEFORE INSERT OR UPDATE OF has_protection, has_permit_zone ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_email_forwarding_id();

-- Index for looking up users by forwarding ID (for incoming email processing)
CREATE UNIQUE INDEX idx_email_forwarding_id ON user_profiles(email_forwarding_id)
WHERE email_forwarding_id IS NOT NULL;

-- Index for cleanup of old residency proofs
CREATE INDEX idx_residency_proof_cleanup
ON user_profiles(residency_proof_uploaded_at)
WHERE residency_proof_path IS NOT NULL;

-- Comments
COMMENT ON COLUMN user_profiles.email_forwarding_id IS 'Unique 5-digit ID for email forwarding address (documents+{id}@autopilotamerica.com)';
COMMENT ON COLUMN user_profiles.email_forwarding_address IS 'Full email forwarding address for utility bills (auto-generated)';
COMMENT ON COLUMN user_profiles.residency_proof_path IS 'Path to most recent utility bill (proof of residency) - auto-deleted after renewal';
COMMENT ON COLUMN user_profiles.residency_forwarding_enabled IS 'User has set up email forwarding from utility provider';
COMMENT ON COLUMN user_profiles.residency_forwarding_consent_given IS 'User consents to automated processing of forwarded utility bills';
