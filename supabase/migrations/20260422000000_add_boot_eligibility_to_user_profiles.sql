-- Pre-tow warning fields. Populated by the CHI PAY scraper when it detects
-- that a subscriber's plate is currently booted and surfaces the date at
-- which the city can tow the vehicle if unpaid. Used to fire SMS/email
-- warnings before a boot-to-tow happens.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS boot_detected_at              timestamptz,
  ADD COLUMN IF NOT EXISTS tow_eligible_date             timestamptz,
  ADD COLUMN IF NOT EXISTS boot_extension_eligible       boolean,
  ADD COLUMN IF NOT EXISTS boot_eligibility_checked_at   timestamptz,
  ADD COLUMN IF NOT EXISTS boot_alert_sent_at            timestamptz;

CREATE INDEX IF NOT EXISTS idx_user_profiles_tow_eligible_date
  ON user_profiles (tow_eligible_date)
  WHERE tow_eligible_date IS NOT NULL;
