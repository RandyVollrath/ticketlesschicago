-- Add geometry column to winter ban streets table for map display
ALTER TABLE winter_overnight_parking_ban_streets
ADD COLUMN IF NOT EXISTS geom JSONB;

-- Add comment
COMMENT ON COLUMN winter_overnight_parking_ban_streets.geom IS 'GeoJSON LineString geometry for map display';
