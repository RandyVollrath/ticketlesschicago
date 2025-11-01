-- San Diego Street Sweeping Schedule Table
-- Data source: https://data.sandiego.gov/datasets/street-sweeping-schedule/

CREATE TABLE IF NOT EXISTS public.sd_street_sweeping (
  id SERIAL PRIMARY KEY,
  objectid INTEGER,
  sapid TEXT,
  rd20full TEXT, -- Street name
  llowaddr TEXT, -- Left side low address
  lhighaddr TEXT, -- Left side high address
  rlowaddr TEXT, -- Right side low address
  rhighaddr TEXT, -- Right side high address
  xstrt1 TEXT, -- Cross street 1 (from)
  xstrt2 TEXT, -- Cross street 2 (to)
  cdcode TEXT, -- Council district code
  cpcode TEXT, -- Community planning code
  zip TEXT,
  posted TEXT, -- Whether parking restrictions are posted
  schedule TEXT, -- Main schedule description (e.g., "Not Posted, Both Sides 4th Mon")
  schedule2 TEXT, -- Additional schedule info

  -- Geocoding fields (to be populated)
  segment_lat DOUBLE PRECISION,
  segment_lng DOUBLE PRECISION,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sd_street_sweeping_street
  ON public.sd_street_sweeping(rd20full);

CREATE INDEX IF NOT EXISTS idx_sd_street_sweeping_location
  ON public.sd_street_sweeping(segment_lat, segment_lng);

CREATE INDEX IF NOT EXISTS idx_sd_street_sweeping_zip
  ON public.sd_street_sweeping(zip);

-- Enable RLS
ALTER TABLE public.sd_street_sweeping ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access"
  ON public.sd_street_sweeping
  FOR SELECT
  USING (true);
