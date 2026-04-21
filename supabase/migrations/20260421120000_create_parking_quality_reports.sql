-- Parking-detection quality reports — rolled-up metrics per 12h window.
-- Populated by pages/api/cron/parking-quality-report.ts twice daily.
-- Each row is one snapshot so we can track trends over time.

CREATE TABLE IF NOT EXISTS parking_quality_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Volume
  total_checks INTEGER NOT NULL DEFAULT 0,
  auto_checks INTEGER NOT NULL DEFAULT 0,   -- has gps_source set or native_meta.detectionSource
  manual_checks INTEGER NOT NULL DEFAULT 0, -- gps_source IS NULL AND no detectionSource

  -- Accuracy
  avg_raw_accuracy_m NUMERIC(6,2),
  pct_accuracy_under_10m NUMERIC(5,2),
  pct_accuracy_over_30m NUMERIC(5,2),

  -- Snap quality
  pct_no_snap NUMERIC(5,2),              -- snap_street_name IS NULL
  pct_snap_over_20m NUMERIC(5,2),        -- car snapped to a distant street
  pct_nominatim_overrode NUMERIC(5,2),   -- nominatim contradicted snap
  pct_heading_confirmed NUMERIC(5,2),    -- compass/GPS agreed with snap

  -- Guards
  pct_walkaway_guard_fired NUMERIC(5,2),
  pct_parity_forced NUMERIC(5,2),

  -- User feedback
  user_feedback_count INTEGER NOT NULL DEFAULT 0,
  street_correct_count INTEGER NOT NULL DEFAULT 0,
  street_wrong_count INTEGER NOT NULL DEFAULT 0,
  side_correct_count INTEGER NOT NULL DEFAULT 0,
  side_wrong_count INTEGER NOT NULL DEFAULT 0,
  pct_street_correct_when_confirmed NUMERIC(5,2),

  -- Downstream signal: when the post-park departure snap found a
  -- DIFFERENT street than the one we saved (the native_meta.auto_label
  -- `street_matched: false` case). That's a clear quality-failure signal.
  autolabel_mismatch_count INTEGER NOT NULL DEFAULT 0,

  -- History quality
  coord_like_address_count INTEGER NOT NULL DEFAULT 0, -- raw coords leaked into the address field
  stale_parks_no_departure_count INTEGER NOT NULL DEFAULT 0, -- parked > 48h without departure_confirmed_at

  -- Change vs previous window
  prev_window_total INTEGER,
  trend_notes JSONB,

  raw_metrics JSONB -- full structured payload for the admin dashboard
);

CREATE INDEX IF NOT EXISTS idx_parking_quality_reports_window
  ON parking_quality_reports(window_end DESC);

COMMENT ON TABLE parking_quality_reports
  IS 'Twice-daily rollup of parking-detection quality signals — read by admin dashboard and trend alerts.';
