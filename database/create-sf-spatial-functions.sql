-- Create PostGIS function to find nearest SF street segment
-- This function takes lat/lng coordinates and returns the nearest street sweeping schedule

CREATE OR REPLACE FUNCTION find_nearest_sf_street(
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  max_distance_meters INTEGER DEFAULT 100
)
RETURNS TABLE (
  id INTEGER,
  cnn VARCHAR,
  corridor VARCHAR,
  limits VARCHAR,
  block_side VARCHAR,
  full_name VARCHAR,
  week_day VARCHAR,
  from_hour INTEGER,
  to_hour INTEGER,
  week1 INTEGER,
  week2 INTEGER,
  week3 INTEGER,
  week4 INTEGER,
  week5 INTEGER,
  holidays INTEGER,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.cnn,
    s.corridor,
    s.limits,
    s.block_side,
    s.full_name,
    s.week_day,
    s.from_hour,
    s.to_hour,
    s.week1,
    s.week2,
    s.week3,
    s.week4,
    s.week5,
    s.holidays,
    ST_Distance(
      s.geom::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
    ) as distance_meters
  FROM
    sf_street_sweeping s
  WHERE
    ST_DWithin(
      s.geom::geography,
      ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
      max_distance_meters
    )
  ORDER BY
    distance_meters ASC
  LIMIT 10;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION find_nearest_sf_street TO authenticated, anon;

COMMENT ON FUNCTION find_nearest_sf_street IS 'Find nearest San Francisco street sweeping schedule by coordinates within max_distance_meters';

-- Create function to get SF streets within map bounds
-- This is used for rendering street segments on the map
CREATE OR REPLACE FUNCTION get_sf_streets_in_bounds(
  sw_lat DOUBLE PRECISION,
  sw_lng DOUBLE PRECISION,
  ne_lat DOUBLE PRECISION,
  ne_lng DOUBLE PRECISION
)
RETURNS TABLE (
  id INTEGER,
  cnn VARCHAR,
  corridor VARCHAR,
  limits VARCHAR,
  block_side VARCHAR,
  full_name VARCHAR,
  week_day VARCHAR,
  from_hour INTEGER,
  to_hour INTEGER,
  week1 INTEGER,
  week2 INTEGER,
  week3 INTEGER,
  week4 INTEGER,
  week5 INTEGER,
  holidays INTEGER,
  geometry JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id,
    s.cnn,
    s.corridor,
    s.limits,
    s.block_side,
    s.full_name,
    s.week_day,
    s.from_hour,
    s.to_hour,
    s.week1,
    s.week2,
    s.week3,
    s.week4,
    s.week5,
    s.holidays,
    ST_AsGeoJSON(s.geom)::jsonb as geometry
  FROM
    sf_street_sweeping s
  WHERE
    s.geom && ST_MakeEnvelope(sw_lng, sw_lat, ne_lng, ne_lat, 4326)
  LIMIT 1000; -- Limit to prevent overwhelming the map
END;
$$ LANGUAGE plpgsql;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_sf_streets_in_bounds TO authenticated, anon;

COMMENT ON FUNCTION get_sf_streets_in_bounds IS 'Get San Francisco street sweeping schedules within map bounds for rendering';
