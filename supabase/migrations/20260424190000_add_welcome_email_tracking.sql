-- Track when the welcome email was sent to a user so the helper is idempotent.
-- Callers check this column before sending and set it to now() on success.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS user_profiles_welcome_email_sent_at_idx
  ON user_profiles (welcome_email_sent_at)
  WHERE welcome_email_sent_at IS NULL;
