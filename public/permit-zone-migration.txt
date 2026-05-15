CREATE TABLE IF NOT EXISTS permit_zone_collection_targets (
  id             serial PRIMARY KEY,
  rank           int NOT NULL,
  street_dir     text NOT NULL,
  street_name    text NOT NULL,
  street_type    text,
  block_low      int NOT NULL,
  citation_count int NOT NULL,
  cluster_label  text,
  status         text NOT NULL DEFAULT 'pending',
  collected_at   timestamptz,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pzct_status  ON permit_zone_collection_targets(status, rank);
CREATE INDEX IF NOT EXISTS idx_pzct_cluster ON permit_zone_collection_targets(cluster_label, status);

CREATE TABLE IF NOT EXISTS permit_zone_field_observations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collected_by     text,
  collected_at     timestamptz NOT NULL DEFAULT now(),
  lat              numeric,
  lon              numeric,
  gps_accuracy_m   numeric,
  segment_row_id   text,
  matched_zone     int,
  street_direction text,
  street_name      text,
  street_type      text,
  block_low        int,
  block_high       int,
  odd_even         text,
  zone_on_sign     int,
  days_mon         bool DEFAULT false,
  days_tue         bool DEFAULT false,
  days_wed         bool DEFAULT false,
  days_thu         bool DEFAULT false,
  days_fri         bool DEFAULT false,
  days_sat         bool DEFAULT false,
  days_sun         bool DEFAULT false,
  all_days         bool DEFAULT false,
  hours_start      time,
  hours_end        time,
  all_times        bool DEFAULT false,
  sign_condition   text,
  raw_sign_text    text,
  notes            text,
  photo_url        text,
  zone_matches     bool,
  reviewed         bool DEFAULT false,
  approved         bool DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_pzfo_zone         ON permit_zone_field_observations(matched_zone);
CREATE INDEX IF NOT EXISTS idx_pzfo_collected_at ON permit_zone_field_observations(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_pzfo_block        ON permit_zone_field_observations(street_direction, street_name, block_low);

ALTER TABLE permit_zone_collection_targets   ENABLE ROW LEVEL SECURITY;
ALTER TABLE permit_zone_field_observations  ENABLE ROW LEVEL SECURITY;
