-- Add indexes for user_parked_vehicles (currently has ZERO indexes beyond PK)
-- and missing partial indexes on parking_location_history.
--
-- snow_events already has good indexes (idx_snow_events_active, date_idx, etc.)

-- =============================================================================
-- user_parked_vehicles — no custom indexes exist, crons scan every 15 min
-- =============================================================================

-- Partial index: cron jobs query WHERE is_active = true constantly.
-- Most rows are inactive (departed). This index stays tiny.
CREATE INDEX IF NOT EXISTS idx_upv_active
  ON public.user_parked_vehicles (parked_at DESC)
  WHERE is_active = true;

-- Per-user lookups: save-parked-location, clear-parked-location both do
-- WHERE user_id = ? AND is_active = true
CREATE INDEX IF NOT EXISTS idx_upv_user_active
  ON public.user_parked_vehicles (user_id)
  WHERE is_active = true;

-- Snow notification query: WHERE is_active = true AND on_snow_route = true
-- AND snow_ban_notified_at IS NULL
CREATE INDEX IF NOT EXISTS idx_upv_snow_route_unnotified
  ON public.user_parked_vehicles (parked_at DESC)
  WHERE is_active = true AND on_snow_route = true AND snow_ban_notified_at IS NULL;

-- Winter ban notification query: WHERE is_active = true
-- AND on_winter_ban_street = true AND winter_ban_notified_at IS NULL
CREATE INDEX IF NOT EXISTS idx_upv_winter_ban_unnotified
  ON public.user_parked_vehicles (parked_at DESC)
  WHERE is_active = true AND on_winter_ban_street = true AND winter_ban_notified_at IS NULL;

-- =============================================================================
-- parking_location_history — has user_id and (user_id, parked_at) indexes
-- but missing partial indexes for common filtered queries
-- =============================================================================

-- clear-parked-location: WHERE user_id = ? AND cleared_at IS NULL
CREATE INDEX IF NOT EXISTS idx_plh_user_uncleared
  ON public.parking_location_history (user_id, parked_at DESC)
  WHERE cleared_at IS NULL;

-- confirm-departure: WHERE user_id = ? AND cleared_at IS NOT NULL
-- AND departure_confirmed_at IS NULL
CREATE INDEX IF NOT EXISTS idx_plh_user_pending_departure
  ON public.parking_location_history (user_id, parked_at DESC)
  WHERE cleared_at IS NOT NULL AND departure_confirmed_at IS NULL;
