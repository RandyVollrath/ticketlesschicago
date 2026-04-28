-- Meter notification fields on user_parked_vehicles
--
-- Two new push notification types depend on these:
--   1. meter_max_expiring  — fires ~15 min before parked_at + max_time_minutes
--                            (only while the meter is currently enforced)
--   2. meter_zone_active   — fires ~30 min before today's enforcement start
--                            for users who parked overnight while the meter
--                            zone was unenforced
--
-- The meter zone lookup itself remains in lib/metered-parking-checker.ts.
-- These columns persist the snapshot at park time so the cron can decide
-- when to notify without re-running the geocode + DB query every 15 min.

ALTER TABLE user_parked_vehicles
  ADD COLUMN IF NOT EXISTS meter_zone_active BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS meter_max_time_minutes INT,
  ADD COLUMN IF NOT EXISTS meter_schedule_text TEXT,
  ADD COLUMN IF NOT EXISTS meter_was_enforced_at_park_time BOOLEAN,
  ADD COLUMN IF NOT EXISTS meter_max_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meter_active_notified_at TIMESTAMPTZ;

-- Partial index: cron only cares about active sessions in meter zones
CREATE INDEX IF NOT EXISTS idx_user_parked_vehicles_meter_active
  ON user_parked_vehicles (parked_at)
  WHERE is_active = TRUE AND meter_zone_active = TRUE;
