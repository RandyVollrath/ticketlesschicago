-- Per-vehicle renewal data so a user can auto-renew multiple plates.
-- Mirrors the fields currently held on user_profiles for the primary plate.
-- The reminder cron iterates monitored_plates rows that have at least one
-- expiry column populated; user_profiles remains the "primary" row for
-- backwards compat and single-plate UX.

ALTER TABLE monitored_plates
  ADD COLUMN IF NOT EXISTS vin TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS license_plate_type TEXT,
  ADD COLUMN IF NOT EXISTS license_plate_renewal_cost DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS city_sticker_expiry DATE,
  ADD COLUMN IF NOT EXISTS license_plate_expiry DATE,
  ADD COLUMN IF NOT EXISTS il_registration_id_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS il_pin_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS il_credentials_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS il_credentials_invalid_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_monitored_plates_renewal_window
  ON monitored_plates (city_sticker_expiry, license_plate_expiry)
  WHERE city_sticker_expiry IS NOT NULL OR license_plate_expiry IS NOT NULL;

COMMENT ON COLUMN monitored_plates.vin IS
  'Per-plate VIN. Defaults to user_profiles.vin for the primary plate, distinct per row when multi-vehicle.';
COMMENT ON COLUMN monitored_plates.il_pin_encrypted IS
  'Per-plate IL SOS PIN, AES-256-GCM via lib/credentials-vault. PIN is plate-scoped, not user-scoped.';

ALTER TABLE renewal_purchase_consents
  ADD COLUMN IF NOT EXISTS plate_id UUID REFERENCES monitored_plates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_renewal_consents_plate
  ON renewal_purchase_consents (plate_id)
  WHERE plate_id IS NOT NULL;

COMMENT ON COLUMN renewal_purchase_consents.plate_id IS
  'Specific monitored_plates row this consent applies to. NULL for legacy consents that used user_profiles primary plate.';
