-- Make nearest_address_point's expected_street comparison normalize-tolerant.
--
-- chicago_building_addresses stores street names in centerline format
-- ("N LAKEWOOD AVE", "W BELDEN AVE"). The check-parking API often passes
-- the post-Nominatim-override street name in OSM's friendly format
-- ("North Lakewood Avenue", "West Belden Avenue"). The original RPC
-- compared with strict equality so the two formats never matched —
-- every override-without-geometry case fell through silently.
--
-- We add a helper that strips:
--   - leading direction prefix (N|S|E|W or full word)
--   - trailing street type (AVE, ST, BLVD, …)
--   - punctuation/whitespace runs
-- …and uppercases the core. Both sides of the comparison use it so any
-- mix of ('N LAKEWOOD AVE', 'North Lakewood Avenue', 'lakewood',
-- 'LAKEWOOD AVE') normalizes to 'LAKEWOOD' and matches.
--
-- Verified against live Belden + Lakewood diagnostics rows where the
-- prior strict comparison silently produced no match.

CREATE OR REPLACE FUNCTION normalize_chicago_street(s TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  result TEXT;
BEGIN
  IF s IS NULL THEN
    RETURN NULL;
  END IF;
  result := upper(s);
  -- Strip leading direction prefix (full word OR single letter, with separator).
  result := regexp_replace(
    result,
    '^\s*(NORTH|SOUTH|EAST|WEST|N|S|E|W)\s+',
    ''
  );
  -- Strip trailing street type suffix (any common Chicago suffix).
  result := regexp_replace(
    result,
    '\s+(AVE|AVENUE|ST|STREET|BLVD|BOULEVARD|RD|ROAD|DR|DRIVE|PL|PLACE|CT|COURT|LN|LANE|PKWY|PARKWAY|HWY|HIGHWAY|TER|TERRACE|WAY|CIR|CIRCLE|XING|CROSSING|SQ|SQUARE|ALY|ALLEY|ROW|WALK|PATH|TRL|TRAIL|PIKE|PASS|RUN|BR|BRANCH|EXPY|EXPRESSWAY|EXT|EXTENSION|GRN|GREEN|HTS|HEIGHTS|SPUR|LOOP|PLAZA|PLZ|CV|COVE|CRK|CREEK|HL|HILL|PT|POINT|RDG|RIDGE|VIS|VISTA)\.?\s*$',
    ''
  );
  -- Collapse non-alphanumeric runs to a single space and trim.
  result := regexp_replace(result, '[^A-Z0-9]+', ' ', 'g');
  result := btrim(result);
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION normalize_chicago_street(TEXT)
  TO authenticated, anon;

COMMENT ON FUNCTION normalize_chicago_street IS
  'Normalize a Chicago street name for fuzzy matching: strip direction prefix, type suffix, punctuation. "N LAKEWOOD AVE" and "North Lakewood Avenue" both → "LAKEWOOD".';

-- Replace nearest_address_point with a version that uses the normalizer
-- on both sides of the comparison.
DROP FUNCTION IF EXISTS nearest_address_point(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT);

CREATE OR REPLACE FUNCTION nearest_address_point(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  search_radius_meters DOUBLE PRECISION DEFAULT 25,
  expected_street TEXT DEFAULT NULL,
  expected_parity TEXT DEFAULT NULL
)
RETURNS TABLE (
  house_number INT,
  full_street_name TEXT,
  pre_dir TEXT,
  street_name TEXT,
  street_type TEXT,
  distance_meters DOUBLE PRECISION
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  expected_norm TEXT := normalize_chicago_street(expected_street);
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
    AND (
      expected_norm IS NULL
      OR normalize_chicago_street(a.full_street_name) = expected_norm
    )
    AND (
      expected_parity IS NULL
      OR (expected_parity = 'O' AND a.house_number % 2 = 1)
      OR (expected_parity = 'E' AND a.house_number % 2 = 0)
    )
  ORDER BY a.point <-> up.pt
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION nearest_address_point TO authenticated, anon;

COMMENT ON FUNCTION nearest_address_point IS
  'Nearest Chicago building to a GPS point. Uses normalize_chicago_street() on both sides of the expected_street filter, so callers can pass either centerline format ("N LAKEWOOD AVE") or OSM format ("North Lakewood Avenue").';
