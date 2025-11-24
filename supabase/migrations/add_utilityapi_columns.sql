-- Add UtilityAPI tracking columns to user_profiles table
-- These columns track utility account connections and bill fetching via UtilityAPI

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS utilityapi_form_uid TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_authorization_uid TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_connected BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS utilityapi_connected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS utilityapi_utility TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_uid TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_pdf_url TEXT,
ADD COLUMN IF NOT EXISTS utilityapi_latest_bill_date TIMESTAMPTZ;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_utilityapi_auth
ON user_profiles(utilityapi_authorization_uid);

-- Add comment
COMMENT ON COLUMN user_profiles.utilityapi_form_uid IS 'UtilityAPI form UID created for this user';
COMMENT ON COLUMN user_profiles.utilityapi_authorization_uid IS 'UtilityAPI authorization UID after user connects utility account';
COMMENT ON COLUMN user_profiles.utilityapi_connected IS 'Whether user has connected their utility account via UtilityAPI';
COMMENT ON COLUMN user_profiles.utilityapi_connected_at IS 'When user connected their utility account';
COMMENT ON COLUMN user_profiles.utilityapi_utility IS 'Utility provider (e.g., ComEd, Peoples Gas)';
COMMENT ON COLUMN user_profiles.utilityapi_latest_bill_uid IS 'UID of most recent bill from UtilityAPI';
COMMENT ON COLUMN user_profiles.utilityapi_latest_bill_pdf_url IS 'URL to download latest bill PDF from UtilityAPI';
COMMENT ON COLUMN user_profiles.utilityapi_latest_bill_date IS 'Date of latest bill';
