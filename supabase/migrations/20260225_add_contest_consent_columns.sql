-- Add contest authorization consent columns to user_profiles
-- These track whether the user has authorized Autopilot America to contest
-- tickets on their behalf per Chicago Municipal Code § 9-100-070 signature requirement.

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS contest_consent BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS contest_consent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS contest_consent_ip TEXT;

COMMENT ON COLUMN user_profiles.contest_consent IS 'Whether user authorized Autopilot to contest tickets on their behalf';
COMMENT ON COLUMN user_profiles.contest_consent_at IS 'When the contest authorization was given';
COMMENT ON COLUMN user_profiles.contest_consent_ip IS 'IP address when contest authorization was given';
