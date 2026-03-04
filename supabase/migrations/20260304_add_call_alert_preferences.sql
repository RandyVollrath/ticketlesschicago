-- Per-alert-type phone call preferences
-- Allows users to choose which alert types trigger phone calls
-- and how many hours before enforcement they want to be called.
-- All types default to disabled — users must explicitly opt in per type.

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS call_alert_preferences jsonb DEFAULT '{
    "street_cleaning": {"enabled": false, "hours_before": 2},
    "winter_ban": {"enabled": false, "hours_before": 6},
    "permit_zone": {"enabled": false, "hours_before": 0},
    "snow_route": {"enabled": false, "hours_before": 0},
    "dot_permit": {"enabled": false, "hours_before": 0}
  }'::jsonb;
