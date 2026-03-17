-- =====================================================
-- STREET CENTERLINES - Comprehensive Chicago Street Geometry
-- =====================================================
-- Contains geometry for ALL Chicago streets (residential + major), imported from:
--   1. City of Chicago Open Data (GitHub: Chicago/osd-street-center-line) — 56K+ segments
--   2. OpenStreetMap Overpass API — fills any gaps in residential streets
--
-- Used by snap_to_nearest_street() to find the nearest street segment for GPS snapping.
-- The previous data sources (street_cleaning_schedule, snow_routes) only covered ~125 major
-- arterials, leaving 95% of residential streets invisible to snap-to-street.
--
-- This table replaces those as the PRIMARY source for street snapping.

-- Ensure PostGIS is available
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create the table
CREATE TABLE IF NOT EXISTS street_centerlines (
  id BIGSERIAL PRIMARY KEY,
  street_name TEXT NOT NULL,         -- Full street name: "N WOLCOTT AVE", "W LAWRENCE AVE"
  street_base_name TEXT,             -- Base name without direction/type: "WOLCOTT", "LAWRENCE"
  pre_dir TEXT,                      -- Direction prefix: N, S, E, W
  street_type TEXT,                  -- Street type: AVE, ST, BLVD, DR, etc.
  class TEXT,                        -- Street classification (from Chicago data): 1=expressway, 2=arterial, 3=collector, 4=residential
  source TEXT NOT NULL DEFAULT 'chicago_open_data',  -- 'chicago_open_data' or 'osm'
  geom geometry(LineString, 4326),   -- LineString geometry in WGS84
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for fast radius queries (critical for snap_to_nearest_street performance)
CREATE INDEX IF NOT EXISTS idx_street_centerlines_geom
  ON street_centerlines USING GIST (geom);

-- Index on street name for lookups
CREATE INDEX IF NOT EXISTS idx_street_centerlines_name
  ON street_centerlines (street_name);

-- Index on base name for cross-referencing
CREATE INDEX IF NOT EXISTS idx_street_centerlines_base_name
  ON street_centerlines (street_base_name);

-- Grant read access for the snap function (runs as SECURITY DEFINER)
GRANT SELECT ON street_centerlines TO authenticated, anon;

-- =====================================================
-- UPDATE snap_to_nearest_street to use street_centerlines
-- =====================================================
-- Drop and recreate with street_centerlines as primary source

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

  -- PRIMARY source: street_centerlines (comprehensive — all Chicago streets)
  cl_candidates AS (
    SELECT
      cl.street_name AS sname,
      cl.geom AS line_geom,
      'street_centerlines' AS source,
      ST_Distance(
        (SELECT pt FROM user_point)::geography,
        cl.geom::geography
      ) AS dist_m
    FROM street_centerlines cl, user_point up
    WHERE cl.geom IS NOT NULL
      AND ST_DWithin(
        up.pt::geography,
        cl.geom::geography,
        search_radius_meters
      )
  ),

  -- FALLBACK: snow_routes (kept as belt-and-suspenders for any gaps)
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

  -- Union all candidates, deduplicate by street name (prefer street_centerlines), keep top 5 closest
  all_candidates AS (
    SELECT DISTINCT ON (sname) sname, line_geom, source, dist_m
    FROM (
      SELECT sname, line_geom, source, dist_m FROM cl_candidates
      UNION ALL
      SELECT sname, line_geom, source, dist_m FROM sr_candidates
    ) combined
    ORDER BY sname, dist_m ASC
  ),

  top_candidates AS (
    SELECT * FROM all_candidates
    ORDER BY dist_m ASC
    LIMIT 5
  ),

  -- For each candidate, compute the snapped point and bearing
  snapped AS (
    SELECT
      c.sname,
      c.source,
      c.dist_m,
      ST_LineLocatePoint(
        CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString'
             THEN ST_GeometryN(c.line_geom, 1)
             ELSE c.line_geom
        END,
        (SELECT pt FROM user_point)
      ) AS frac,
      ST_ClosestPoint(c.line_geom, (SELECT pt FROM user_point)) AS closest_pt,
      CASE WHEN ST_GeometryType(c.line_geom) = 'ST_MultiLineString'
           THEN ST_GeometryN(c.line_geom, 1)
           ELSE c.line_geom
      END AS single_line
    FROM top_candidates c
  ),

  -- Compute bearing at snapped point
  with_bearing AS (
    SELECT
      s.sname,
      s.source,
      s.dist_m,
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

GRANT EXECUTE ON FUNCTION snap_to_nearest_street TO authenticated, anon;

COMMENT ON FUNCTION snap_to_nearest_street IS
  'Snaps a GPS coordinate to the nearest known street segment. Uses street_centerlines (comprehensive Chicago street geometry) as primary source with snow_routes as fallback. Returns up to 5 candidates with snapped coordinates, distance, street name, and street bearing for heading-based disambiguation.';

COMMENT ON TABLE street_centerlines IS
  'Comprehensive Chicago street center line geometry. Imported from City of Chicago Open Data + OpenStreetMap. Used by snap_to_nearest_street() for GPS-to-street snapping at parking events.';
