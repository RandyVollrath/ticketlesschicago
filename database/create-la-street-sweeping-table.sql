-- Create table for Los Angeles street sweeping schedules
CREATE TABLE IF NOT EXISTS la_street_sweeping (
  id SERIAL PRIMARY KEY,
  route_no TEXT NOT NULL,
  council_district TEXT,
  time_start TEXT,
  time_end TEXT,
  boundaries TEXT,
  day_of_week TEXT, -- M, Tu, W, Th, F
  geom GEOMETRY(POLYGON, 4326), -- PostGIS polygon for spatial matching
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on route_no for faster lookups
CREATE INDEX IF NOT EXISTS idx_la_route_no ON la_street_sweeping(route_no);

-- Create index on boundaries for text search
CREATE INDEX IF NOT EXISTS idx_la_boundaries ON la_street_sweeping USING gin(to_tsvector('english', boundaries));

-- Create index on day_of_week
CREATE INDEX IF NOT EXISTS idx_la_day_of_week ON la_street_sweeping(day_of_week);

-- Create spatial index on geometry for fast polygon matching
CREATE INDEX IF NOT EXISTS idx_la_geom ON la_street_sweeping USING GIST(geom);
