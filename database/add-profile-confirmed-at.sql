-- Add profile_confirmed_at column to track when user confirms their profile is up-to-date
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS profile_confirmed_at TIMESTAMPTZ;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_profile_confirmed_at ON user_profiles(profile_confirmed_at);

-- Add comment explaining the column
COMMENT ON COLUMN user_profiles.profile_confirmed_at IS 'Timestamp when user confirmed their profile information is current. Used to determine if 60/45/37-day reminders are still mandatory for Protection users.';
