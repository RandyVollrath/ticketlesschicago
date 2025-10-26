-- Functions needed for mobile app parking location API

-- 1. Get street cleaning at location
CREATE OR REPLACE FUNCTION get_street_cleaning_at_location(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  street_name TEXT,
  schedule TEXT,
  distance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sc.street_name::TEXT,
    sc.schedule::TEXT,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      sc.geometry::geography
    ) as distance
  FROM street_cleaning sc
  WHERE ST_DWithin(
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    sc.geometry::geography,
    distance_meters
  )
  ORDER BY distance
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Get snow route at location
CREATE OR REPLACE FUNCTION get_snow_route_at_location(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  street_name TEXT,
  distance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sr.street_name::TEXT,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      sr.geometry::geography
    ) as distance
  FROM snow_routes sr
  WHERE ST_DWithin(
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    sr.geometry::geography,
    distance_meters
  )
  ORDER BY distance
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Get permit zone at location
CREATE OR REPLACE FUNCTION get_permit_zone_at_location(
  user_lat FLOAT,
  user_lng FLOAT,
  distance_meters FLOAT DEFAULT 30
)
RETURNS TABLE (
  zone_name TEXT,
  hours TEXT,
  street_name TEXT,
  distance FLOAT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pz.zone_name::TEXT,
    pz.restricted_hours::TEXT as hours,
    pz.street_name::TEXT,
    ST_Distance(
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      pz.geometry::geography
    ) as distance
  FROM permit_zones pz
  WHERE ST_DWithin(
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    pz.geometry::geography,
    distance_meters
  )
  ORDER BY distance
  LIMIT 1;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permissions to authenticated and anon users
GRANT EXECUTE ON FUNCTION get_street_cleaning_at_location TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_snow_route_at_location TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_permit_zone_at_location TO authenticated, anon;
