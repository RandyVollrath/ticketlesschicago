-- mobile_ground_truth_events: persistent log of user-confirmed and
-- user-corrected parking events from the mobile app. The endpoint
-- pages/api/mobile/ground-truth.ts has been writing here since the
-- correction UI shipped, but the table was never created — the endpoint
-- catches the error and returns success:true so the mobile queue keeps
-- flowing. Every user correction has been silently dropped, and
-- lookupUserParkingAnchor (used as a tie-breaker in check-parking) has
-- been returning null forever.
--
-- Caught 2026-04-30 while building the geocoder accuracy ledger
-- (QA_REPORT.md net #6+).
--
-- Schema mirrors the rows the endpoint inserts.

CREATE TABLE IF NOT EXISTS mobile_ground_truth_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  event_ts TIMESTAMPTZ NOT NULL,
  drive_session_id TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_ground_truth_events_user_event_ts
  ON mobile_ground_truth_events (user_id, event_ts DESC);

-- Anchor lookup spatially filters by lat/lng with a small bbox around the
-- new park location. A composite index lets that bbox + recency filter run fast.
CREATE INDEX IF NOT EXISTS idx_mobile_ground_truth_events_user_latlng
  ON mobile_ground_truth_events (user_id, latitude, longitude, event_ts DESC)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_ground_truth_events_event_type
  ON mobile_ground_truth_events (event_type, event_ts DESC);

-- RLS: owner-only read; service role bypasses (used by check-parking server).
ALTER TABLE mobile_ground_truth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY mobile_ground_truth_events_owner_select
  ON mobile_ground_truth_events
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON TABLE mobile_ground_truth_events IS
  'User-confirmed (parking_confirmed) and user-corrected (parking_street_correction) events from the mobile app. Source of truth for the per-tool geocoder accuracy ledger and the anchor tie-breaker in check-parking.';
