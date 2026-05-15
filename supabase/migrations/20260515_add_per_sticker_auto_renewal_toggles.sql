-- Per-sticker auto-renewal toggles.
--
-- Background: auto_renewal_authorized (added 20260512221840) is the master
-- "this user has opted into auto-renewal at all" gate. To let users opt in to
-- city-sticker renewal without opting in to plate-sticker renewal (or vice
-- versa) we need two more columns. Both default FALSE so existing rows are
-- unchanged — admin-granted users keep getting nothing until the per-type
-- toggles are explicitly flipped (admin script or user via /settings).

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS auto_renewal_city_sticker BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_renewal_license_plate BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN user_profiles.auto_renewal_city_sticker IS
  'If TRUE AND auto_renewal_authorized=TRUE, the create-authorized-renewal-consents cron will queue Chicago city sticker renewals.';
COMMENT ON COLUMN user_profiles.auto_renewal_license_plate IS
  'If TRUE AND auto_renewal_authorized=TRUE, the create-authorized-renewal-consents cron will queue IL plate sticker renewals.';

-- Partial indexes to keep the cron-side filters cheap. Both filtered queries
-- AND on auto_renewal_authorized so a composite would be slightly better,
-- but the master gate is already indexed and the per-type set will be small.
CREATE INDEX IF NOT EXISTS idx_user_profiles_auto_renewal_city_sticker
  ON user_profiles (auto_renewal_city_sticker)
  WHERE auto_renewal_city_sticker = TRUE;

CREATE INDEX IF NOT EXISTS idx_user_profiles_auto_renewal_license_plate
  ON user_profiles (auto_renewal_license_plate)
  WHERE auto_renewal_license_plate = TRUE;

-- Backfill: any user who was already admin-granted (auto_renewal_authorized=
-- TRUE) before this migration should keep working without re-granting. Set
-- the per-sticker flag TRUE for each sticker type whose credentials they
-- already have on file. Users missing credentials stay FALSE so the cron
-- still skips them (no charge without complete data).
UPDATE user_profiles
SET auto_renewal_city_sticker = TRUE
WHERE auto_renewal_authorized = TRUE
  AND license_plate IS NOT NULL
  AND vin IS NOT NULL
  AND last_name IS NOT NULL
  AND auto_renewal_city_sticker = FALSE;

UPDATE user_profiles
SET auto_renewal_license_plate = TRUE
WHERE auto_renewal_authorized = TRUE
  AND il_pin_encrypted IS NOT NULL
  AND il_registration_id_encrypted IS NOT NULL
  AND il_credentials_invalid_at IS NULL
  AND auto_renewal_license_plate = FALSE;
