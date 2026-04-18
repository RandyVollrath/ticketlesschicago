-- Chicago Building Footprints with addresses — imported from the city's
-- "Building Footprints" open dataset (syp8-uezg, ~820K rows). Lets us resolve
-- a parking GPS coordinate to an actual house number from a registered
-- building, instead of interpolating along a centerline segment.
--
-- Usage: the nearest_address_point RPC returns the closest building with a
-- valid (non-zero) label_hous within a radius. check-parking.ts calls it
-- after snap; if a building is found within ~25m, its label_hous replaces
-- whatever number came from segment interpolation.

CREATE TABLE IF NOT EXISTS chicago_building_addresses (
  id BIGSERIAL PRIMARY KEY,
  bldg_id TEXT,
  house_number INT,                   -- label_hous parsed as integer; skip rows where it's 0
  pre_dir TEXT,                       -- N / S / E / W
  street_name TEXT,                   -- e.g. WOLCOTT
  street_type TEXT,                   -- e.g. AVE / ST / BLVD
  -- Normalized full street (matches street_centerlines.street_name).
  -- "N WOLCOTT AVE"
  full_street_name TEXT,
  point geometry(Point, 4326),        -- building centroid (we query this)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chicago_building_addresses_point
  ON chicago_building_addresses USING GIST (point);
CREATE INDEX IF NOT EXISTS idx_chicago_building_addresses_full_street
  ON chicago_building_addresses (full_street_name);
CREATE INDEX IF NOT EXISTS idx_chicago_building_addresses_house
  ON chicago_building_addresses (house_number)
  WHERE house_number > 0;

GRANT SELECT ON chicago_building_addresses TO authenticated, anon;

COMMENT ON TABLE chicago_building_addresses IS
  'Chicago building footprint centroids with house numbers. Used by nearest_address_point() for precise house-number lookup during parking checks.';

-- Finds the nearest building to a GPS point, optionally constrained to a
-- specific street (so we don't match the house across the street on the wrong
-- corner). Returns the building's house_number, full street, and distance.
CREATE OR REPLACE FUNCTION nearest_address_point(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  search_radius_meters DOUBLE PRECISION DEFAULT 25,
  expected_street TEXT DEFAULT NULL     -- e.g. 'N WOLCOTT AVE' to restrict match
)
RETURNS TABLE (
  house_number INT,
  full_street_name TEXT,
  pre_dir TEXT,
  street_name TEXT,
  street_type TEXT,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  WITH user_point AS (
    SELECT ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326) AS pt
  )
  SELECT
    a.house_number,
    a.full_street_name,
    a.pre_dir,
    a.street_name,
    a.street_type,
    ST_Distance(a.point::geography, up.pt::geography) AS distance_meters
  FROM chicago_building_addresses a, user_point up
  WHERE a.house_number > 0
    AND a.full_street_name IS NOT NULL
    AND ST_DWithin(a.point::geography, up.pt::geography, search_radius_meters)
    AND (expected_street IS NULL OR a.full_street_name = expected_street)
  ORDER BY a.point <-> up.pt    -- KNN index-assisted nearest-neighbor
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION nearest_address_point TO authenticated, anon;

COMMENT ON FUNCTION nearest_address_point IS
  'Finds the nearest Chicago building address to a GPS point, optionally constrained to a street name. Returns house_number and full_street_name.';
