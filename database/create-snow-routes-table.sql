-- Create snow_routes table to store Two-Inch Snow Ban street data
-- This table contains all street segments where the 2-inch parking ban applies

CREATE TABLE IF NOT EXISTS public.snow_routes (
  id SERIAL PRIMARY KEY,
  object_id INTEGER,
  on_street VARCHAR(255) NOT NULL,
  from_street VARCHAR(255),
  to_street VARCHAR(255),
  restrict_type VARCHAR(100),
  shape_length DECIMAL(12, 6),
  geom GEOMETRY(MULTILINESTRING, 4326),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on street name for fast lookups
CREATE INDEX IF NOT EXISTS idx_snow_routes_on_street ON public.snow_routes(on_street);

-- Create spatial index for geometry queries
CREATE INDEX IF NOT EXISTS idx_snow_routes_geom ON public.snow_routes USING GIST(geom);

-- Add comment to table
COMMENT ON TABLE public.snow_routes IS 'Chicago Two-Inch Snow Ban parking restriction streets. Data from FOIA request to CDOT.';

-- Enable RLS (Row Level Security)
ALTER TABLE public.snow_routes ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access to authenticated users
CREATE POLICY "Allow read access to snow routes"
  ON public.snow_routes
  FOR SELECT
  USING (true);

-- Grant permissions
GRANT SELECT ON public.snow_routes TO authenticated, anon;
