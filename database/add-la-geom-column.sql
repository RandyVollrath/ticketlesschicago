-- Add geometry column to existing la_street_sweeping table
ALTER TABLE la_street_sweeping ADD COLUMN IF NOT EXISTS geom GEOMETRY(POLYGON, 4326);

-- Create spatial index on geometry for fast polygon matching
CREATE INDEX IF NOT EXISTS idx_la_geom ON la_street_sweeping USING GIST(geom);
