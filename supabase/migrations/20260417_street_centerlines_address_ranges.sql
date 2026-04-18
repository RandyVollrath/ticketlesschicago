-- Add address range columns to street_centerlines so house-number interpolation
-- can replace the current linear-latitude approximation (off by 20-50 numbers
-- per block). Also extends snap_to_nearest_street to return the new fields so
-- callers get segment address ranges + fractional position in one round-trip.
--
-- Chicago's centerline GeoJSON includes these fields per segment:
--   L_F_ADD, L_T_ADD — left-side address range (from → to)
--   R_F_ADD, R_T_ADD — right-side address range (from → to)
--
-- After running this migration, re-run scripts/import-street-centerlines.ts
-- to populate the new columns (the script already reads L_F_ADD/L_T_ADD/etc
-- from the Chicago GeoJSON).

ALTER TABLE public.street_centerlines
  ADD COLUMN IF NOT EXISTS l_from_addr INT,
  ADD COLUMN IF NOT EXISTS l_to_addr   INT,
  ADD COLUMN IF NOT EXISTS r_from_addr INT,
  ADD COLUMN IF NOT EXISTS r_to_addr   INT;

COMMENT ON COLUMN public.street_centerlines.l_from_addr IS 'Left-side low address (Chicago GeoJSON L_F_ADD).';
COMMENT ON COLUMN public.street_centerlines.l_to_addr   IS 'Left-side high address (Chicago GeoJSON L_T_ADD).';
COMMENT ON COLUMN public.street_centerlines.r_from_addr IS 'Right-side low address (Chicago GeoJSON R_F_ADD).';
COMMENT ON COLUMN public.street_centerlines.r_to_addr   IS 'Right-side high address (Chicago GeoJSON R_T_ADD).';

-- Extend snap_to_nearest_street to return segment_fraction + per-side address
-- ranges. Existing callers that select by column name keep working (extra
-- columns are just ignored).
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
  segment_fraction DOUBLE PRECISION,    -- 0.0 = start of segment, 1.0 = end
  l_from_addr INT,
  l_to_addr   INT,
  r_from_addr INT,
  r_to_addr   INT
) AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH user_point AS (
    SELECT ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326) AS pt
  ),
  cl_candidates AS (
    SELECT
      cl.street_name AS sname,
      cl.geom AS line_geom,
      'street_centerlines' AS source,
      cl.l_from_addr, cl.l_to_addr, cl.r_from_addr, cl.r_to_addr,
      ST_Distance((SELECT pt FROM user_point)::geography, cl.geom::geography) AS dist_m
    FROM street_centerlines cl, user_point up
    WHERE cl.geom IS NOT NULL
      AND ST_DWithin(up.pt::geography, cl.geom::geography, search_radius_meters)
  ),
  sr_candidates AS (
    SELECT
      sr.on_street AS sname,
      sr.geom::geometry(Geometry, 4326) AS line_geom,
      'snow_route' AS source,
      NULL::INT AS l_from_addr, NULL::INT AS l_to_addr,
      NULL::INT AS r_from_addr, NULL::INT AS r_to_addr,
      ST_Distance((SELECT pt FROM user_point)::geography, sr.geom::geography) AS dist_m
    FROM snow_routes sr, user_point up
    WHERE sr.geom IS NOT NULL
      AND ST_DWithin(up.pt::geography, sr.geom::geography, search_radius_meters)
  ),
  all_candidates AS (
    SELECT DISTINCT ON (sname) sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr
    FROM (
      SELECT sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr FROM cl_candidates
      UNION ALL
      SELECT sname, line_geom, source, dist_m, l_from_addr, l_to_addr, r_from_addr, r_to_addr FROM sr_candidates
    ) combined
    ORDER BY sname, dist_m ASC
  ),
  top_candidates AS (
    SELECT * FROM all_candidates
    ORDER BY dist_m ASC
    LIMIT 5
  ),
  snapped AS (
    SELECT
      c.sname, c.source, c.dist_m,
      c.l_from_addr, c.l_to_addr, c.r_from_addr, c.r_to_addr,
      ST_LineLocatePoint(
        CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString'
             THEN ST_GeometryN(c.line_geom, 1)
             ELSE c.line_geom END,
        (SELECT pt FROM user_point)
      ) AS frac,
      ST_ClosestPoint(c.line_geom, (SELECT pt FROM user_point)) AS closest_pt,
      CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString'
           THEN ST_GeometryN(c.line_geom, 1)
           ELSE c.line_geom END AS single_line
    FROM top_candidates c
  ),
  with_bearing AS (
    SELECT
      s.sname, s.source, s.dist_m, s.frac,
      s.l_from_addr, s.l_to_addr, s.r_from_addr, s.r_to_addr,
      ST_Y(s.closest_pt) AS snap_lat,
      ST_X(s.closest_pt) AS snap_lng,
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
    TRUE AS was_snapped,
    wb.dist_m AS snap_distance_meters,
    wb.snap_lat AS snapped_lat,
    wb.snap_lng AS snapped_lng,
    wb.sname AS street_name,
    wb.source AS snap_source,
    COALESCE(wb.bearing_deg, -1) AS street_bearing,
    wb.frac AS segment_fraction,
    wb.l_from_addr, wb.l_to_addr, wb.r_from_addr, wb.r_to_addr
  FROM with_bearing wb
  ORDER BY wb.dist_m ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION snap_to_nearest_street TO authenticated, anon;

COMMENT ON FUNCTION snap_to_nearest_street IS
  'Snaps a GPS coordinate to the nearest known street segment. Returns segment address ranges + fractional position so callers can interpolate an exact house number.';
