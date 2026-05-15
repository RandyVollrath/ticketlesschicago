-- Permit Zone Field Collection
-- Two tables for the field-ops workflow:
--   1. permit_zone_collection_targets — priority list of blocks to capture (seeded from FOIA ticket counts)
--   2. permit_zone_field_observations — one row per sign photographed in the field

CREATE TABLE IF NOT EXISTS permit_zone_collection_targets (
  id            serial PRIMARY KEY,
  rank          int NOT NULL,                       -- 1 = most-cited
  street_dir    text NOT NULL,                      -- N / S / E / W
  street_name   text NOT NULL,
  street_type   text,                               -- ST / AVE / BLVD / PL ...
  block_low     int NOT NULL,                       -- e.g. 1100
  citation_count int NOT NULL,                      -- from 0964090E tickets
  cluster_label text,                               -- 'Lakeview', 'Near North', etc.
  status        text NOT NULL DEFAULT 'pending',    -- pending | in_progress | done | skip
  collected_at  timestamptz,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pzct_status ON permit_zone_collection_targets(status, rank);
CREATE INDEX IF NOT EXISTS idx_pzct_cluster ON permit_zone_collection_targets(cluster_label, status);

CREATE TABLE IF NOT EXISTS permit_zone_field_observations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_by   text,
  collected_at   timestamptz NOT NULL DEFAULT now(),

  -- Raw GPS at time of capture
  lat            numeric,
  lon            numeric,
  gps_accuracy_m numeric,

  -- Segment matched from address / GPS (filled by API at submit time)
  segment_row_id    text,            -- u9xt-hiju row_id
  matched_zone      int,
  street_direction  text,
  street_name       text,
  street_type       text,
  block_low         int,
  block_high        int,
  odd_even          text,             -- 'O' or 'E'

  -- Sign data entered by collector
  zone_on_sign      int,              -- what the collector reads off the sign
  days_mon          bool DEFAULT false,
  days_tue          bool DEFAULT false,
  days_wed          bool DEFAULT false,
  days_thu          bool DEFAULT false,
  days_fri          bool DEFAULT false,
  days_sat          bool DEFAULT false,
  days_sun          bool DEFAULT false,
  all_days          bool DEFAULT false,
  hours_start       time,
  hours_end         time,
  all_times         bool DEFAULT false,
  sign_condition    text,              -- 'clear'|'faded'|'damaged'|'obscured'|'missing'
  raw_sign_text     text,
  notes             text,
  photo_url         text,

  -- Cross-validation flags
  zone_matches      bool,              -- TRUE iff zone_on_sign == matched_zone
  reviewed          bool DEFAULT false,
  approved          bool DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_pzfo_zone ON permit_zone_field_observations(matched_zone);
CREATE INDEX IF NOT EXISTS idx_pzfo_collected_at ON permit_zone_field_observations(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pzfo_block ON permit_zone_field_observations(street_direction, street_name, block_low);

-- RLS: no anon access, service-role only (writes go through API endpoints)
ALTER TABLE permit_zone_collection_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_zone_field_observations ENABLE ROW LEVEL SECURITY;
