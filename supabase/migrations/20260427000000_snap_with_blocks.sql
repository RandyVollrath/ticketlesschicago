-- Multi-block snap variant — surfaces wrong-block alternates to the user.
--
-- Background: snap_to_nearest_street() does DISTINCT ON (sname), keeping only
-- the closest segment per street name. So for a stretch of N WOLCOTT AVE that
-- spans multiple blocks within ~80m of GPS (e.g. 4500 block AND 4400 block
-- both within range), only the closest one is returned. The other one is
-- structurally invisible — meaning the mobile "Wrong street?" modal can't
-- offer it as a tappable alternate even when block ambiguity is real.
--
-- This new function preserves the same snap mechanics (ranges, parity,
-- one-way, snow_route fallback, the 15m centerline preference bonus) but
-- replaces DISTINCT ON with ROW_NUMBER() OVER (PARTITION BY sname) so up to
-- max_per_street segments per street name come through. Default max_per_street=2
-- is enough for the common "wrong block of Wolcott" case; max_total caps the
-- result set so the cascade stays fast.
--
-- The original snap_to_nearest_street is kept as-is so existing callers
-- (probe scripts, smoke tests, lib/chicago-grid-estimator.ts) don't change.

CREATE OR REPLACE FUNCTION snap_to_nearest_street_with_blocks(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  search_radius_meters DOUBLE PRECISION DEFAULT 40,
  max_per_street INTEGER DEFAULT 2,
  max_total INTEGER DEFAULT 8
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
  combined AS (
    -- Same 15m centerline preference bonus as snap_to_nearest_street: when
    -- the same street appears in both sources, prefer the centerline row
    -- (has address ranges + parity + oneway). The bonus is applied to the
    -- ranking distance only — actual snap_distance_meters returned is the
    -- raw geographic distance, unchanged from the original function.
    SELECT sname, line_geom, source, dist_m,
      l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity,
      CASE WHEN source = 'street_centerlines' THEN dist_m - 15 ELSE dist_m END AS sort_dist
    FROM (SELECT * FROM cl_candidates UNION ALL SELECT * FROM sr_candidates) c
  ),
  ranked AS (
    -- Key change vs snap_to_nearest_street: rank within each street name
    -- and keep top max_per_street, instead of DISTINCT ON (sname) which
    -- collapses to one. This is what surfaces the wrong-block alternate.
    SELECT *,
      ROW_NUMBER() OVER (PARTITION BY sname ORDER BY sort_dist ASC) AS rn_within_street
    FROM combined
  ),
  filtered AS (
    SELECT * FROM ranked WHERE rn_within_street <= max_per_street
    ORDER BY sort_dist ASC
    LIMIT max_total
  ),
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
    FROM filtered c
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

GRANT EXECUTE ON FUNCTION snap_to_nearest_street_with_blocks TO authenticated, anon;

COMMENT ON FUNCTION snap_to_nearest_street_with_blocks IS
  'Like snap_to_nearest_street but returns up to max_per_street segments per street name (ROW_NUMBER ranking instead of DISTINCT ON). Use this when you need to surface multi-block ambiguity (e.g. 4500 vs 4400 Wolcott both within range) for user disambiguation.';
