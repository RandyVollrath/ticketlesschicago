-- PostGIS function to calculate distance from a point to the nearest edge of a zone polygon
-- Returns distance in meters

CREATE OR REPLACE FUNCTION calculate_distance_from_point(
  point_lat double precision,
  point_lng double precision,
  zone_ward text,
  zone_section text
)
RETURNS double precision
LANGUAGE plpgsql
AS $$
DECLARE
  zone_geom geometry;
  point_geom geography;
  distance_meters double precision;
BEGIN
  -- Get the zone geometry
  SELECT geom_simplified INTO zone_geom
  FROM street_cleaning_schedule
  WHERE ward = zone_ward AND section = zone_section
  AND geom_simplified IS NOT NULL
  LIMIT 1;

  IF zone_geom IS NULL THEN
    RETURN NULL;
  END IF;

  -- Create a point geography from the lat/lng
  point_geom := ST_SetSRID(ST_MakePoint(point_lng, point_lat), 4326)::geography;

  -- Calculate distance using ST_Distance
  -- ST_Distance on geography returns meters
  distance_meters := ST_Distance(point_geom, zone_geom::geography);

  RETURN distance_meters;
END;
$$;
