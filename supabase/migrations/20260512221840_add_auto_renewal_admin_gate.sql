-- Admin-only gate for the auto-renewal feature.
-- Cron jobs MUST filter on auto_renewal_authorized = TRUE.
-- Default is FALSE so no user is auto-renewed without explicit admin grant.
-- Layer 2 of two-layer gate; Layer 1 is the AUTO_RENEWAL_GLOBALLY_ENABLED env var.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS auto_renewal_authorized BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_renewal_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_renewal_authorized_by TEXT,
  ADD COLUMN IF NOT EXISTS auto_renewal_authorization_reason TEXT;

COMMENT ON COLUMN user_profiles.auto_renewal_authorized IS
  'Admin-only flag. Defaults FALSE. Cron filters on this column — no user is auto-renewed until admin explicitly grants.';
COMMENT ON COLUMN user_profiles.auto_renewal_authorized_at IS
  'When the admin granted auto-renewal authorization.';
COMMENT ON COLUMN user_profiles.auto_renewal_authorized_by IS
  'Email of the admin who granted authorization (audit).';
COMMENT ON COLUMN user_profiles.auto_renewal_authorization_reason IS
  'Free-text reason for grant (e.g. "internal QA", "beta user batch 1").';

CREATE INDEX IF NOT EXISTS idx_user_profiles_auto_renewal_authorized
  ON user_profiles (auto_renewal_authorized)
  WHERE auto_renewal_authorized = TRUE;
