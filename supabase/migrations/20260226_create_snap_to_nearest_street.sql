-- =====================================================
-- SNAP TO NEAREST STREET - GPS Road-Snapping Function
-- =====================================================
-- Returns candidate street segments near a GPS point, each with:
--   - Snapped coordinates (closest point on the street line)
--   - Distance from GPS point to snapped point
--   - Street name
--   - Street bearing at the snapped point (0-360, degrees clockwise from north)
--
-- Used by check-parking.ts to correct urban canyon GPS drift (10-30m)
-- and disambiguate between candidate streets using car heading.
--
-- Sources: street_cleaning_schedule (most comprehensive) + snow_routes

-- Drop existing function first (return type changed — added street_bearing)
DROP FUNCTION IF EXISTS snap_to_nearest_street(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION);

CREATE OR REPLACE FUNCTION snap_to_nearest_street(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  search_radius_meters DOUBLE PRECISION DEFAULT 40
)
RETURNS TABLE (
  was_snapped BOOLEAN,
  snap_distance_meters DOUBLE PRECISION,
  snapped_lat DOUBLE PRECISION,
  snapped_lng DOUBLE PRECISION,
  street_name TEXT,
  snap_source TEXT,
  street_bearing DOUBLE PRECISION  -- 0-360 degrees, clockwise from north
) AS $$
BEGIN
  RETURN QUERY
  WITH user_point AS (
    SELECT ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326) AS pt
  ),

  -- Candidates from street_cleaning_schedule (primary source — most streets)
  sc_candidates AS (
    SELECT
      sc.street_name AS sname,
      sc.geom AS line_geom,
      'street_cleaning' AS source,
      ST_Distance(
        (SELECT pt FROM user_point)::geography,
        sc.geom::geography
      ) AS dist_m
    FROM street_cleaning_schedule sc, user_point up
    WHERE sc.geom IS NOT NULL
      AND ST_DWithin(
        up.pt::geography,
        sc.geom::geography,
        search_radius_meters
      )
  ),

  -- Candidates from snow_routes (secondary — adds arterial streets)
  sr_candidates AS (
    SELECT
      sr.on_street AS sname,
      sr.geom::geometry(Geometry, 4326) AS line_geom,
      'snow_route' AS source,
      ST_Distance(
        (SELECT pt FROM user_point)::geography,
        sr.geom::geography
      ) AS dist_m
    FROM snow_routes sr, user_point up
    WHERE sr.geom IS NOT NULL
      AND ST_DWithin(
        up.pt::geography,
        sr.geom::geography,
        search_radius_meters
      )
  ),

  -- Union all candidates, keep top 5 closest
  all_candidates AS (
    SELECT sname, line_geom, source, dist_m FROM sc_candidates
    UNION ALL
    SELECT sname, line_geom, source, dist_m FROM sr_candidates
    ORDER BY dist_m ASC
    LIMIT 5
  ),

  -- For each candidate, compute the snapped point and bearing
  snapped AS (
    SELECT
      c.sname,
      c.source,
      c.dist_m,
      -- Fraction along line closest to user point
      ST_LineLocatePoint(
        CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString'
             THEN ST_GeometryN(c.line_geom, 1)  -- Use first linestring for multi
             ELSE c.line_geom
        END,
        (SELECT pt FROM user_point)
      ) AS frac,
      -- Closest point on line
      ST_ClosestPoint(c.line_geom, (SELECT pt FROM user_point)) AS closest_pt,
      -- The line geometry (handle multi)
      CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString'
           THEN ST_GeometryN(c.line_geom, 1)
           ELSE c.line_geom
      END AS single_line
    FROM all_candidates c
  ),

  -- Compute bearing at snapped point using a small segment around the fraction
  with_bearing AS (
    SELECT
      s.sname,
      s.source,
      s.dist_m,
      ST_Y(s.closest_pt) AS snap_lat,
      ST_X(s.closest_pt) AS snap_lng,
      -- Bearing: use points at frac-0.01 and frac+0.01 along line
      -- ST_Azimuth returns radians, convert to degrees
      degrees(
        ST_Azimuth(
          ST_LineInterpolatePoint(s.single_line, GREATEST(s.frac - 0.01, 0)),
          ST_LineInterpolatePoint(s.single_line, LEAST(s.frac + 0.01, 1))
        )
      ) AS bearing_deg
    FROM snapped s
    WHERE s.single_line IS NOT NULL
      AND ST_NPoints(s.single_line) >= 2
  )

  SELECT
    true AS was_snapped,
    wb.dist_m AS snap_distance_meters,
    wb.snap_lat AS snapped_lat,
    wb.snap_lng AS snapped_lng,
    wb.sname AS street_name,
    wb.source AS snap_source,
    COALESCE(wb.bearing_deg, -1) AS street_bearing
  FROM with_bearing wb
  ORDER BY wb.dist_m ASC;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access
GRANT EXECUTE ON FUNCTION snap_to_nearest_street TO authenticated, anon;

COMMENT ON FUNCTION snap_to_nearest_street IS
  'Snaps a GPS coordinate to the nearest known street segment. Returns up to 5 candidates with snapped coordinates, distance, street name, and street bearing for heading-based disambiguation.';
