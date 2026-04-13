-- =====================================================
-- PARKING DIAGNOSTICS — Full decision chain for every parking check
-- =====================================================
-- Captures the complete diagnostic trail for each parking location determination.
-- Used for: regression testing, accuracy measurement, GPS correction learning,
-- and forensic debugging of wrong-street/wrong-side errors.
--
-- Every row represents one call to /api/mobile/check-parking.

CREATE TABLE IF NOT EXISTS parking_diagnostics (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES auth.users(id),

  -- Raw input from mobile client
  raw_lat DOUBLE PRECISION NOT NULL,
  raw_lng DOUBLE PRECISION NOT NULL,
  raw_accuracy_meters DOUBLE PRECISION,
  gps_heading DOUBLE PRECISION,           -- GPS-derived heading (may be stale)
  compass_heading DOUBLE PRECISION,       -- Magnetometer heading (fresh, zero-speed)
  compass_confidence DOUBLE PRECISION,    -- Circular std dev in degrees
  gps_source TEXT,                        -- driving-buffer, stop-start, fast-single, cache-fallback, etc.

  -- Snap-to-street result
  snap_street_name TEXT,
  snap_distance_meters DOUBLE PRECISION,
  snap_source TEXT,                        -- street_cleaning, snow_route, nominatim_override
  snap_bearing DOUBLE PRECISION,
  snapped_lat DOUBLE PRECISION,
  snapped_lng DOUBLE PRECISION,

  -- Heading disambiguation
  heading_source TEXT,                     -- compass, gps, none
  effective_heading DOUBLE PRECISION,
  heading_orientation TEXT,                -- N-S or E-W (what heading suggested)

  -- Nominatim cross-reference
  nominatim_street TEXT,
  nominatim_orientation TEXT,              -- N-S or E-W
  nominatim_agreed BOOLEAN,               -- Did Nominatim confirm the snap?
  nominatim_overrode BOOLEAN DEFAULT FALSE, -- Did Nominatim override the snap?
  heading_confirmed_snap BOOLEAN,          -- Did heading agree with snap (blocking override)?

  -- Final determination
  resolved_address TEXT,
  resolved_street_name TEXT,
  resolved_street_direction TEXT,          -- N, S, E, W
  resolved_house_number INTEGER,
  resolved_side TEXT,                      -- N, S, E, W (side of street)
  side_source TEXT,                        -- heading, parity, centerline-geometry

  -- Walk-away detection
  walkaway_guard_fired BOOLEAN DEFAULT FALSE,
  walkaway_details TEXT,                   -- which guard fired and why

  -- Parity forcing
  parity_forced BOOLEAN DEFAULT FALSE,
  forced_parity TEXT,                      -- odd or even

  -- Metered parking
  metered_block BOOLEAN DEFAULT FALSE,
  meters_on_user_side INTEGER,
  meters_on_opposite_side INTEGER,

  -- Quality signals
  near_intersection BOOLEAN DEFAULT FALSE,
  snap_candidates_count INTEGER,

  -- User feedback (Layer 2 — filled in later by mobile client)
  user_confirmed_parking BOOLEAN,          -- Did parking actually occur? (not a red light)
  user_confirmed_block BOOLEAN,            -- Is the street/block correct?
  user_reported_side TEXT,                 -- N, S, E, W — which side user says they're on
  user_feedback_at TIMESTAMPTZ,

  -- Computed accuracy (filled after user feedback)
  street_correct BOOLEAN,                  -- resolved_street matches user confirmation
  side_correct BOOLEAN,                    -- resolved_side matches user_reported_side
  location_error_meters DOUBLE PRECISION   -- distance from raw GPS to nearest ground truth
);

-- Index for user lookups and recent events
CREATE INDEX idx_parking_diagnostics_user_time
  ON parking_diagnostics (user_id, created_at DESC);

-- Index for regression replay (all events, chronological)
CREATE INDEX idx_parking_diagnostics_created
  ON parking_diagnostics (created_at DESC);

-- Index for finding events with user feedback (ground truth)
CREATE INDEX idx_parking_diagnostics_feedback
  ON parking_diagnostics (user_feedback_at)
  WHERE user_feedback_at IS NOT NULL;

-- RLS: users can see/update their own diagnostics
ALTER TABLE parking_diagnostics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own diagnostics"
  ON parking_diagnostics FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own feedback"
  ON parking_diagnostics FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can insert (server-side API)
CREATE POLICY "Service role can insert diagnostics"
  ON parking_diagnostics FOR INSERT
  WITH CHECK (true);

COMMENT ON TABLE parking_diagnostics IS
  'Full diagnostic trail for every parking location check. Captures raw GPS, snap results, heading decisions, Nominatim cross-reference, and user feedback for accuracy measurement and regression testing.';
