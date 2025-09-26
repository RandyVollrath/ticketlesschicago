-- Enable PostGIS extension if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- Create function to find street cleaning section for a point
-- This assumes you have a street_cleaning_schedule table with geometric data
CREATE OR REPLACE FUNCTION find_section_for_point(lat float8, lon float8)
RETURNS TABLE(ward text, section text) AS $$
BEGIN
  -- Convert lat/lon to a PostGIS point
  RETURN QUERY
  SELECT 
    s.ward::text,
    s.section::text
  FROM street_cleaning_schedule s
  WHERE s.geom IS NOT NULL 
    AND ST_Contains(s.geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;