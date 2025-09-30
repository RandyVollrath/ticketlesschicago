-- Add has_protection column to user_profiles table
-- This tracks whether a user has purchased the premium Ticket Protection plan

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS has_protection BOOLEAN NOT NULL DEFAULT false;

-- Add index for filtering protected users
CREATE INDEX IF NOT EXISTS idx_user_profiles_has_protection ON user_profiles(has_protection);

COMMENT ON COLUMN user_profiles.has_protection IS 'True if user has purchased Ticket Protection premium plan ($12/mo or $120/yr)';