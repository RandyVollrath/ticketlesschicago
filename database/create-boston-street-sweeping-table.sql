-- Create boston_street_sweeping table for Boston street sweeping schedule data

CREATE TABLE IF NOT EXISTS public.boston_street_sweeping (
  id SERIAL PRIMARY KEY,
  main_id INTEGER,
  st_name VARCHAR(255) NOT NULL,
  dist VARCHAR(50),
  dist_name VARCHAR(255),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  side VARCHAR(20), -- Even, Odd, or blank (both sides)
  from_street VARCHAR(255),
  to_street VARCHAR(255),
  miles DECIMAL(10, 6),
  section VARCHAR(100),
  one_way BOOLEAN DEFAULT false,
  week_1 BOOLEAN DEFAULT false,
  week_2 BOOLEAN DEFAULT false,
  week_3 BOOLEAN DEFAULT false,
  week_4 BOOLEAN DEFAULT false,
  week_5 BOOLEAN DEFAULT false,
  sunday BOOLEAN DEFAULT false,
  monday BOOLEAN DEFAULT false,
  tuesday BOOLEAN DEFAULT false,
  wednesday BOOLEAN DEFAULT false,
  thursday BOOLEAN DEFAULT false,
  friday BOOLEAN DEFAULT false,
  saturday BOOLEAN DEFAULT false,
  every_day BOOLEAN DEFAULT false,
  year_round BOOLEAN DEFAULT false,
  north_end_pilot BOOLEAN DEFAULT false,
  parent VARCHAR(50),
  losta INTEGER,
  hista INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_boston_street_sweeping_st_name ON public.boston_street_sweeping(st_name);
CREATE INDEX IF NOT EXISTS idx_boston_street_sweeping_dist ON public.boston_street_sweeping(dist);

-- Add comment
COMMENT ON TABLE public.boston_street_sweeping IS 'Boston street sweeping schedule data from data.boston.gov open data portal';

-- Enable RLS
ALTER TABLE public.boston_street_sweeping ENABLE ROW LEVEL SECURITY;

-- Allow read access to all users
CREATE POLICY "Allow read access to Boston street sweeping data"
  ON public.boston_street_sweeping
  FOR SELECT
  USING (true);

-- Grant permissions
GRANT SELECT ON public.boston_street_sweeping TO authenticated, anon;
