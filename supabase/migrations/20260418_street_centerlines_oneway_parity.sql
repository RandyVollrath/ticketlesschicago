-- Add one-way direction and left/right parity columns to street_centerlines.
-- These let us determine which side of the street a car is parked on for
-- one-way streets, where the heading-based rule (right side of travel) fails
-- when parking is allowed on the left side too (common in Chicago).
--
-- Fields come from the Chicago GeoJSON per segment:
--   ONEWAY_DIR — "N"/"S"/"E"/"W" for one-way streets, null for two-way
--   L_PARITY   — "O" (odd) or "E" (even) — parity of left-side addresses
--   R_PARITY   — "O" or "E" — parity of right-side addresses
--
-- After running this migration, re-run scripts/import-street-centerlines.ts
-- to populate the new columns.

ALTER TABLE public.street_centerlines
  ADD COLUMN IF NOT EXISTS oneway_dir TEXT,
  ADD COLUMN IF NOT EXISTS l_parity CHAR(1),
  ADD COLUMN IF NOT EXISTS r_parity CHAR(1);

COMMENT ON COLUMN public.street_centerlines.oneway_dir IS 'One-way traffic direction (N/S/E/W) from Chicago ONEWAY_DIR; null for two-way';
COMMENT ON COLUMN public.street_centerlines.l_parity   IS 'Parity of left-side addresses (O=odd, E=even)';
COMMENT ON COLUMN public.street_centerlines.r_parity   IS 'Parity of right-side addresses (O=odd, E=even)';

CREATE INDEX IF NOT EXISTS idx_street_centerlines_oneway
  ON public.street_centerlines(oneway_dir)
  WHERE oneway_dir IS NOT NULL;

-- Extend snap_to_nearest_street to return the new fields.
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
    SELECT DISTINCT ON (sname) sname, line_geom, source, dist_m,
      l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity
    FROM (
      SELECT sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity FROM cl_candidates
      UNION ALL
      SELECT sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr, oneway_dir, l_parity, r_parity FROM sr_candidates
    ) combined
    ORDER BY sname, dist_m ASC
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
