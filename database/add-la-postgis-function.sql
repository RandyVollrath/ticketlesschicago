-- Create PostGIS function to find LA route for a given point (lat/lng)
-- Similar to Chicago's find_section_for_point function

CREATE OR REPLACE FUNCTION find_la_route_for_point(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION
)
RETURNS TABLE (
  id INTEGER,
  route_no TEXT,
  council_district TEXT,
  time_start TEXT,
  time_end TEXT,
  boundaries TEXT,
  day_of_week TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    la_street_sweeping.id,
    la_street_sweeping.route_no,
    la_street_sweeping.council_district,
    la_street_sweeping.time_start,
    la_street_sweeping.time_end,
    la_street_sweeping.boundaries,
    la_street_sweeping.day_of_week
  FROM la_street_sweeping
  WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(lng, lat), 4326))
  LIMIT 10; -- User might be on edge of multiple routes
END;
$$ LANGUAGE plpgsql;
