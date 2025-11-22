-- Add permit-related fields to user_profiles table
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS permit_requested BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS drivers_license_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_residency_url TEXT,
  ADD COLUMN IF NOT EXISTS permit_zone_number TEXT,
  ADD COLUMN IF NOT EXISTS permit_application_status TEXT DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS home_address_full TEXT;

-- Add comment to clarify permit_requested
COMMENT ON COLUMN user_profiles.permit_requested IS 'Whether user opted-in to residential parking permit at checkout';
COMMENT ON COLUMN user_profiles.drivers_license_url IS 'URL to uploaded driver''s license document (required for permit)';
COMMENT ON COLUMN user_profiles.proof_of_residency_url IS 'URL to uploaded proof of residency document (required for permit)';
COMMENT ON COLUMN user_profiles.permit_zone_number IS 'Chicago parking permit zone number (e.g., 143)';
COMMENT ON COLUMN user_profiles.permit_application_status IS 'Status: not_started, pending_documents, documents_uploaded, submitted, approved, denied';
COMMENT ON COLUMN user_profiles.home_address_full IS 'Full home address for permit application';
