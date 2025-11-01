-- St. Louis Street Cleaning Proof of Concept
-- Tables with stl_ prefix to keep completely separate from Chicago data

-- Enable PostGIS if not already enabled
CREATE EXTENSION IF NOT EXISTS postgis;

-- 1. Street Cleaning Zones (with PostGIS geometry)
CREATE TABLE IF NOT EXISTS stl_street_cleaning_zones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_name TEXT NOT NULL,
  ward TEXT,
  section TEXT,
  geometry GEOMETRY(MULTIPOLYGON, 4326), -- WGS84 coordinates
  cleaning_frequency TEXT, -- e.g., "monthly", "weekly"
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Spatial index for fast lookups
CREATE INDEX IF NOT EXISTS idx_stl_zones_geometry
  ON stl_street_cleaning_zones USING GIST(geometry);

-- Regular indexes
CREATE INDEX IF NOT EXISTS idx_stl_zones_ward
  ON stl_street_cleaning_zones(ward);

-- 2. Street Cleaning Schedule (dates per zone)
CREATE TABLE IF NOT EXISTS stl_street_cleaning_schedule (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  zone_id UUID REFERENCES stl_street_cleaning_zones(id),
  zone_name TEXT NOT NULL,
  cleaning_date DATE NOT NULL,
  cleaning_time_start TIME,
  cleaning_time_end TIME,
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast date lookups
CREATE INDEX IF NOT EXISTS idx_stl_schedule_date
  ON stl_street_cleaning_schedule(cleaning_date);

CREATE INDEX IF NOT EXISTS idx_stl_schedule_zone_date
  ON stl_street_cleaning_schedule(zone_id, cleaning_date);

-- 3. Function to find nearest zone (like Chicago's get_nearest_street_cleaning_zone)
CREATE OR REPLACE FUNCTION get_nearest_stl_cleaning_zone(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  max_distance_meters INTEGER DEFAULT 100
)
RETURNS TABLE (
  zone_id UUID,
  zone_name TEXT,
  ward TEXT,
  section TEXT,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    z.id,
    z.zone_name,
    z.ward,
    z.section,
    ST_Distance(
      ST_Transform(z.geometry::geometry, 3857),
      ST_Transform(ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geometry, 3857)
    ) as distance_meters
  FROM stl_street_cleaning_zones z
  WHERE ST_DWithin(
    ST_Transform(z.geometry::geometry, 3857),
    ST_Transform(ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geometry, 3857),
    max_distance_meters
  )
  ORDER BY distance_meters ASC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- Comments
COMMENT ON TABLE stl_street_cleaning_zones IS 'St. Louis street cleaning zones with PostGIS geometry polygons';
COMMENT ON TABLE stl_street_cleaning_schedule IS 'St. Louis street cleaning calendar by zone';
COMMENT ON FUNCTION get_nearest_stl_cleaning_zone IS 'Find nearest St. Louis cleaning zone for given lat/lng coordinates';
