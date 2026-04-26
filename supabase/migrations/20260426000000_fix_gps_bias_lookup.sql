-- =====================================================
-- FIX GPS BIAS LOOKUP — make Layer 4 correction actually work
-- =====================================================
-- The original Step 0 correction in pages/api/mobile/check-parking.ts
-- estimated block centroids from a half-broken grid formula that
-- hardcoded the perpendicular axis to State/Madison. The 200m proximity
-- check never passed for real blocks, so the correction was dead code.
--
-- Additionally, build-gps-corrections.ts had a TODO where the offset
-- learning was supposed to happen and never wrote anything — every row
-- in gps_block_corrections has offset_lat=0/offset_lng=0.
--
-- This migration adds:
--   1. block_centroid_lat/lng columns + indexes for proximity lookup
--   2. find_gps_correction(p_lat, p_lng) — single-roundtrip RPC for the
--      check-parking Step 0 path
--   3. refresh_block_centroids_from_meters() — bulk-set centroids from
--      averaged meter positions
--   4. refresh_block_offsets_from_diagnostics() — learn offset_lat/lng
--      as the mean (centroid - raw_gps) over confident-snap parking events

ALTER TABLE gps_block_corrections
  ADD COLUMN IF NOT EXISTS block_centroid_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS block_centroid_lng DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_gps_corrections_centroid_lat
  ON gps_block_corrections (block_centroid_lat)
  WHERE block_centroid_lat IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gps_corrections_centroid_lng
  ON gps_block_corrections (block_centroid_lng)
  WHERE block_centroid_lng IS NOT NULL;

-- ---------------------------------------------------------
-- Lookup: find the nearest learned correction for a raw GPS point
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION find_gps_correction(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_max_meters DOUBLE PRECISION DEFAULT 150,
  p_min_samples INTEGER DEFAULT 3
)
RETURNS TABLE (
  street_direction TEXT,
  street_name TEXT,
  block_number INTEGER,
  offset_lat DOUBLE PRECISION,
  offset_lng DOUBLE PRECISION,
  sample_count INTEGER,
  distance_m DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lat_window DOUBLE PRECISION;
  lng_window DOUBLE PRECISION;
BEGIN
  lat_window := p_max_meters / 111000.0;
  lng_window := p_max_meters / (111000.0 * COS(RADIANS(p_lat)));

  RETURN QUERY
  SELECT
    c.street_direction,
    c.street_name,
    c.block_number,
    c.offset_lat,
    c.offset_lng,
    c.sample_count,
    SQRT(
      POWER((c.block_centroid_lat - p_lat) * 111000, 2) +
      POWER((c.block_centroid_lng - p_lng) * 111000 * COS(RADIANS(p_lat)), 2)
    ) AS distance_m
  FROM gps_block_corrections c
  WHERE c.block_centroid_lat IS NOT NULL
    AND c.block_centroid_lng IS NOT NULL
    AND c.sample_count >= p_min_samples
    AND (c.offset_lat <> 0 OR c.offset_lng <> 0)
    AND c.block_centroid_lat BETWEEN (p_lat - lat_window) AND (p_lat + lat_window)
    AND c.block_centroid_lng BETWEEN (p_lng - lng_window) AND (p_lng + lng_window)
  ORDER BY (
    POWER((c.block_centroid_lat - p_lat) * 111000, 2) +
    POWER((c.block_centroid_lng - p_lng) * 111000 * COS(RADIANS(p_lat)), 2)
  ) ASC
  LIMIT 1;
END;
$$;

-- ---------------------------------------------------------
-- Aggregator: populate block_centroid_lat/lng from meter averages
-- Returns the number of (insert + update) rows touched.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_block_centroids_from_meters()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  touched INTEGER;
BEGIN
  WITH block_centroids AS (
    SELECT
      direction AS street_direction,
      street_name,
      (FLOOR(block_start::numeric / 100) * 100)::INTEGER AS block_number,
      AVG(latitude) AS centroid_lat,
      AVG(longitude) AS centroid_lng,
      COUNT(*) AS meter_count
    FROM metered_parking_locations
    WHERE status = 'Active'
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
      AND direction IS NOT NULL
      AND street_name IS NOT NULL
      AND block_start IS NOT NULL
    GROUP BY direction, street_name, FLOOR(block_start::numeric / 100) * 100
  )
  INSERT INTO gps_block_corrections (
    street_direction, street_name, block_number,
    block_centroid_lat, block_centroid_lng,
    offset_lat, offset_lng, sample_count, last_updated
  )
  SELECT
    street_direction, street_name, block_number,
    centroid_lat, centroid_lng,
    0, 0, 0, NOW()
  FROM block_centroids
  ON CONFLICT (street_direction, street_name, block_number)
  DO UPDATE SET
    block_centroid_lat = EXCLUDED.block_centroid_lat,
    block_centroid_lng = EXCLUDED.block_centroid_lng;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$;

-- ---------------------------------------------------------
-- Aggregator: learn offset_lat/lng from parking_diagnostics
-- For each metered block, compute mean (block_centroid - raw_gps)
-- across all confident-snap events on that block.
-- Returns the number of blocks with updated offsets.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_block_offsets_from_diagnostics(
  p_min_events INTEGER DEFAULT 3,
  p_max_snap_distance_m DOUBLE PRECISION DEFAULT 25
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  touched INTEGER;
BEGIN
  WITH block_offsets AS (
    SELECT
      pd.resolved_street_direction AS street_direction,
      pd.resolved_street_name AS street_name,
      (FLOOR(pd.resolved_house_number::numeric / 100) * 100)::INTEGER AS block_number,
      AVG(c.block_centroid_lat - pd.raw_lat) AS mean_offset_lat,
      AVG(c.block_centroid_lng - pd.raw_lng) AS mean_offset_lng,
      COUNT(*) AS event_count
    FROM parking_diagnostics pd
    JOIN gps_block_corrections c
      ON c.street_direction = pd.resolved_street_direction
      AND c.street_name = pd.resolved_street_name
      AND c.block_number = (FLOOR(pd.resolved_house_number::numeric / 100) * 100)::INTEGER
    WHERE pd.raw_lat IS NOT NULL
      AND pd.raw_lng IS NOT NULL
      AND pd.resolved_street_name IS NOT NULL
      AND pd.resolved_street_direction IS NOT NULL
      AND pd.resolved_house_number IS NOT NULL
      AND c.block_centroid_lat IS NOT NULL
      AND c.block_centroid_lng IS NOT NULL
      AND pd.snap_distance_meters IS NOT NULL
      AND pd.snap_distance_meters <= p_max_snap_distance_m
    GROUP BY pd.resolved_street_direction, pd.resolved_street_name,
             FLOOR(pd.resolved_house_number::numeric / 100) * 100
    HAVING COUNT(*) >= p_min_events
  )
  UPDATE gps_block_corrections c
  SET
    offset_lat = bo.mean_offset_lat,
    offset_lng = bo.mean_offset_lng,
    sample_count = bo.event_count,
    last_updated = NOW()
  FROM block_offsets bo
  WHERE c.street_direction = bo.street_direction
    AND c.street_name = bo.street_name
    AND c.block_number = bo.block_number;

  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$;

GRANT EXECUTE ON FUNCTION find_gps_correction(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION refresh_block_centroids_from_meters() TO service_role;
GRANT EXECUTE ON FUNCTION refresh_block_offsets_from_diagnostics(INTEGER, DOUBLE PRECISION) TO service_role;
