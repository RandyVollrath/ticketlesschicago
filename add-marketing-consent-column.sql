-- Add marketing_consent column to user_profiles table for CAN-SPAM compliance
-- This allows users to opt-in to marketing emails about new services

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN DEFAULT false;

-- Add comment to explain the column
COMMENT ON COLUMN user_profiles.marketing_consent IS 'User consent to receive marketing emails about new ticket-prevention services (CAN-SPAM compliant)';
