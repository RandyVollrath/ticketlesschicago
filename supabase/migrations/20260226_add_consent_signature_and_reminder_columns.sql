-- Add contest_consent_signature and consent_reminder_sent_at columns to user_profiles
--
-- contest_consent_signature: Stores the typed name used as the e-signature
--   when the user authorized contest-by-mail on their behalf.
--   Examples: "John Smith" (from signup form), "John Smith (via email reply)" (from I AUTHORIZE reply)
--
-- consent_reminder_sent_at: Tracks when the last consent reminder email was sent
--   to this user, to rate-limit reminders to once every 3 days.

ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS contest_consent_signature TEXT,
ADD COLUMN IF NOT EXISTS consent_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN user_profiles.contest_consent_signature IS 'The typed name provided as electronic signature for contest authorization (Illinois UETA)';
COMMENT ON COLUMN user_profiles.consent_reminder_sent_at IS 'When the last consent reminder email was sent (rate-limited to every 3 days)';
