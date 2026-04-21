-- Prefer street_centerlines over snow_routes when the same street appears in both.
--
-- Background (2026-04-21 Randy's Wolcott/Lawrence park):
--   At the Wolcott/Lawrence corner, snap_to_nearest_street returned "W LAWRENCE AVE"
--   from source='snow_route' at 11.6m, with NULL address ranges. The same street was
--   also available in street_centerlines (with proper l_from_addr / r_from_addr
--   fields), but DISTINCT ON (sname) ORDER BY dist_m ASC kept the snow_route row
--   (closer) and discarded the centerline row. Downstream block-aware segment
--   interpolation then had no address ranges to work with, and the display fell
--   through to the Nominatim/grid fallback "2029 W Lawrence".
--
-- Fix: give street_centerlines a 15m distance "bonus" when tie-breaking against
-- snow_routes for the same street name. If street_centerlines is within 15m of
-- snow_route's distance, street_centerlines wins — so we keep the address ranges,
-- one-way direction, and parity fields. If street_centerlines is significantly
-- further (>15m), snow_route still wins (rare — only when the centerline dataset
-- is missing the segment entirely, e.g. mid-block geometry gap).
--
-- Snow routes are also a useful SECONDARY source for streets that aren't in
-- street_centerlines at all (older data coverage), so we don't remove them.

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
  street_bearing DOUBLE PRECISION,
  segment_fraction DOUBLE PRECISION,
  l_from_addr INT,
  l_to_addr   INT,
  r_from_addr INT,
  r_to_addr   INT,
  oneway_dir  TEXT,
  l_parity    CHAR(1),
  r_parity    CHAR(1)
) AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH user_point AS (SELECT ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326) AS pt),
  cl_candidates AS (
    SELECT cl.street_name AS sname, cl.geom AS line_geom, 'street_centerlines' AS source,
      cl.l_from_addr, cl.l_to_addr, cl.r_from_addr, cl.r_to_addr,
      cl.oneway_dir, cl.l_parity, cl.r_parity,
      ST_Distance((SELECT pt FROM user_point)::geography, cl.geom::geography) AS dist_m
    FROM street_centerlines cl, user_point up
    WHERE cl.geom IS NOT NULL
      AND ST_DWithin(up.pt::geography, cl.geom::geography, search_radius_meters)
  ),
  sr_candidates AS (
    SELECT sr.on_street AS sname, sr.geom::geometry(Geometry, 4326) AS line_geom, 'snow_route' AS source,
      NULL::INT AS l_from_addr, NULL::INT AS l_to_addr,
      NULL::INT AS r_from_addr, NULL::INT AS r_to_addr,
      NULL::TEXT AS oneway_dir, NULL::CHAR(1) AS l_parity, NULL::CHAR(1) AS r_parity,
      ST_Distance((SELECT pt FROM user_point)::geography, sr.geom::geography) AS dist_m
    FROM snow_routes sr, user_point up
    WHERE sr.geom IS NOT NULL
      AND ST_DWithin(up.pt::geography, sr.geom::geography, search_radius_meters)
  ),
  all_candidates AS (
    -- Per-street-name dedup. Prefer street_centerlines (address ranges + parity
    -- + one-way fields) unless snow_route is >15m closer. Expressed by ranking
    -- street_centerlines rows with a -15m "bonus" in the sort key.
    SELECT DISTINCT ON (sname) sname, line_geom, source, dist_m,
      l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity
    FROM (
      SELECT sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity FROM cl_candidates
      UNION ALL
      SELECT sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity FROM sr_candidates
    ) combined
    ORDER BY sname,
      CASE WHEN source = 'street_centerlines' THEN dist_m - 15 ELSE dist_m END ASC
  ),
  top_candidates AS (SELECT * FROM all_candidates ORDER BY dist_m ASC LIMIT 5),
  snapped AS (
    SELECT c.sname, c.source, c.dist_m,
      c.l_from_addr, c.l_to_addr, c.r_from_addr, c.r_to_addr,
      c.oneway_dir, c.l_parity, c.r_parity,
      ST_LineLocatePoint(
        CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString' THEN ST_GeometryN(c.line_geom, 1) ELSE c.line_geom END,
        (SELECT pt FROM user_point)
      ) AS frac,
      ST_ClosestPoint(c.line_geom, (SELECT pt FROM user_point)) AS closest_pt,
      CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString' THEN ST_GeometryN(c.line_geom, 1) ELSE c.line_geom END AS single_line
    FROM top_candidates c
  ),
  with_bearing AS (
    SELECT s.sname, s.source, s.dist_m, s.frac,
      s.l_from_addr, s.l_to_addr, s.r_from_addr, s.r_to_addr,
      s.oneway_dir, s.l_parity, s.r_parity,
      ST_Y(s.closest_pt) AS snap_lat, ST_X(s.closest_pt) AS snap_lng,
      degrees(ST_Azimuth(
        ST_LineInterpolatePoint(s.single_line, GREATEST(s.frac - 0.01, 0)),
        ST_LineInterpolatePoint(s.single_line, LEAST(s.frac + 0.01, 1))
      )) AS bearing_deg
    FROM snapped s
    WHERE s.single_line IS NOT NULL AND ST_NPoints(s.single_line) >= 2
  )
  SELECT TRUE, wb.dist_m, wb.snap_lat, wb.snap_lng, wb.sname, wb.source,
    COALESCE(wb.bearing_deg, -1), wb.frac,
    wb.l_from_addr, wb.l_to_addr, wb.r_from_addr, wb.r_to_addr,
    wb.oneway_dir, wb.l_parity, wb.r_parity
  FROM with_bearing wb
  ORDER BY wb.dist_m ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION snap_to_nearest_street TO authenticated, anon;

COMMENT ON FUNCTION snap_to_nearest_street IS
  'Snaps a GPS coordinate to the nearest known street segment. Prefers street_centerlines (has address ranges + parity + oneway) over snow_routes when the same street is in both (15m tolerance). Snow_routes kept as fallback for streets not in the centerlines dataset.';
