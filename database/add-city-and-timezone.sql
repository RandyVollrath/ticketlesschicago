-- Add city and timezone fields to user_profiles
-- This allows us to support multiple cities and send reminders at the right local time

-- Add city column (defaults to chicago for existing users)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS city VARCHAR(50) DEFAULT 'chicago';

-- Add timezone column (defaults to America/Chicago for existing users)
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS timezone VARCHAR(100) DEFAULT 'America/Chicago';

-- Add index for city-based queries (for cron jobs)
CREATE INDEX IF NOT EXISTS idx_user_profiles_city ON user_profiles(city);

-- Add comments
COMMENT ON COLUMN user_profiles.city IS 'User city: chicago, san-francisco, boston, etc.';
COMMENT ON COLUMN user_profiles.timezone IS 'User timezone: America/Chicago, America/Los_Angeles, America/New_York, etc.';

-- Update existing users to have chicago as their city
UPDATE user_profiles
SET city = 'chicago', timezone = 'America/Chicago'
WHERE city IS NULL OR city = '';
