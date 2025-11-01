-- Create sf_street_sweeping table to store San Francisco street sweeping schedule data
-- This table contains all street segments with sweeping schedules and GeoJSON coordinates

CREATE TABLE IF NOT EXISTS public.sf_street_sweeping (
  id SERIAL PRIMARY KEY,
  cnn VARCHAR(50) NOT NULL UNIQUE, -- Street segment ID (unique identifier)
  corridor VARCHAR(255) NOT NULL, -- Street name (e.g., "Market St")
  limits VARCHAR(500), -- Cross streets (e.g., "Larkin St  -  Polk St")
  cnn_right_left VARCHAR(10), -- L or R
  block_side VARCHAR(50), -- Direction (e.g., "SouthEast", "West")
  full_name VARCHAR(255), -- Full schedule name (e.g., "Tuesday", "Tue 1st & 3rd")
  week_day VARCHAR(50) NOT NULL, -- Day of week (e.g., "Tues", "Mon")
  from_hour INTEGER NOT NULL, -- Start hour (0-23)
  to_hour INTEGER NOT NULL, -- End hour (0-23)
  week1 INTEGER NOT NULL DEFAULT 0, -- 1 if sweeps on week 1, 0 otherwise
  week2 INTEGER NOT NULL DEFAULT 0, -- 1 if sweeps on week 2, 0 otherwise
  week3 INTEGER NOT NULL DEFAULT 0, -- 1 if sweeps on week 3, 0 otherwise
  week4 INTEGER NOT NULL DEFAULT 0, -- 1 if sweeps on week 4, 0 otherwise
  week5 INTEGER NOT NULL DEFAULT 0, -- 1 if sweeps on week 5, 0 otherwise
  holidays INTEGER NOT NULL DEFAULT 0, -- 1 if sweeps on holidays, 0 otherwise
  block_sweep_id VARCHAR(50), -- Block ID
  geom GEOMETRY(LINESTRING, 4326), -- GeoJSON geometry
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index on street name for fast lookups
CREATE INDEX IF NOT EXISTS idx_sf_street_sweeping_corridor ON public.sf_street_sweeping(corridor);

-- Create index on CNN for unique lookups
CREATE INDEX IF NOT EXISTS idx_sf_street_sweeping_cnn ON public.sf_street_sweeping(cnn);

-- Create spatial index for geometry queries (finding nearby streets)
CREATE INDEX IF NOT EXISTS idx_sf_street_sweeping_geom ON public.sf_street_sweeping USING GIST(geom);

-- Create composite index for day-of-week queries
CREATE INDEX IF NOT EXISTS idx_sf_street_sweeping_weekday ON public.sf_street_sweeping(week_day);

-- Add comment to table
COMMENT ON TABLE public.sf_street_sweeping IS 'San Francisco street sweeping schedule data. Contains street segments with cleaning schedules and GeoJSON coordinates.';

-- Enable RLS (Row Level Security)
ALTER TABLE public.sf_street_sweeping ENABLE ROW LEVEL SECURITY;

-- Create policy to allow read access to all users
CREATE POLICY "Allow read access to SF street sweeping data"
  ON public.sf_street_sweeping
  FOR SELECT
  USING (true);

-- Grant permissions
GRANT SELECT ON public.sf_street_sweeping TO authenticated, anon;
