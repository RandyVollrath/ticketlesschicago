-- DOT Permits table
-- Stores Chicago Department of Transportation permits that affect parking
-- (moving vans, filming, construction, block parties, festivals, etc.)
-- Synced daily from Chicago Data Portal SODA API

CREATE TABLE IF NOT EXISTS dot_permits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  application_number text NOT NULL UNIQUE,
  work_type text,              -- e.g., 'Moving Van Parking', 'Filming', 'Festival', 'Block Party'
  work_description text,       -- Full work type description from API
  start_date timestamp with time zone NOT NULL,
  end_date timestamp with time zone NOT NULL,
  street_number_from integer,
  street_number_to integer,
  direction text,              -- N, S, E, W
  street_name text,
  suffix text,                 -- AVE, ST, BLVD, etc.
  latitude double precision,
  longitude double precision,
  location geography(Point, 4326),  -- PostGIS point for spatial queries
  street_closure text,         -- 'Full', 'Curblane', 'Sidewalk', 'Intermittent', 'None', NULL
  parking_meter_bagging boolean DEFAULT false,
  ward text,
  comments text,
  application_status text,     -- 'Open', 'Closed', etc.
  application_name text,       -- Event/project name
  synced_at timestamp with time zone DEFAULT now()
);

-- Spatial index for proximity queries (most important index)
CREATE INDEX IF NOT EXISTS idx_dot_permits_location
  ON dot_permits USING gist (location);

-- Date range index for filtering active/upcoming permits
CREATE INDEX IF NOT EXISTS idx_dot_permits_dates
  ON dot_permits (start_date, end_date);

-- Status index for filtering open permits
CREATE INDEX IF NOT EXISTS idx_dot_permits_status
  ON dot_permits (application_status);

-- Composite index for the most common query pattern
CREATE INDEX IF NOT EXISTS idx_dot_permits_active_with_parking
  ON dot_permits (start_date, end_date)
  WHERE (parking_meter_bagging = true OR street_closure IS NOT NULL);

-- RPC function: find DOT permits near a location that are active on a given date
CREATE OR REPLACE FUNCTION get_dot_permits_at_location(
  user_lat double precision,
  user_lng double precision,
  distance_meters double precision DEFAULT 100,
  check_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  application_number text,
  work_type text,
  work_description text,
  start_date timestamp with time zone,
  end_date timestamp with time zone,
  street_number_from integer,
  street_number_to integer,
  direction text,
  street_name text,
  suffix text,
  street_closure text,
  parking_meter_bagging boolean,
  comments text,
  application_name text,
  distance_m double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    dp.application_number,
    dp.work_type,
    dp.work_description,
    dp.start_date,
    dp.end_date,
    dp.street_number_from,
    dp.street_number_to,
    dp.direction,
    dp.street_name,
    dp.suffix,
    dp.street_closure,
    dp.parking_meter_bagging,
    dp.comments,
    dp.application_name,
    ST_Distance(
      dp.location::geography,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) AS distance_m
  FROM dot_permits dp
  WHERE
    dp.location IS NOT NULL
    AND dp.application_status = 'Open'
    AND dp.start_date::date <= (check_date + interval '7 days')  -- Include permits starting within 7 days
    AND dp.end_date::date >= check_date                           -- Not yet expired
    AND (dp.parking_meter_bagging = true OR dp.street_closure IS NOT NULL)
    AND ST_DWithin(
      dp.location::geography,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      distance_meters
    )
  ORDER BY distance_m ASC
  LIMIT 5;
$$;

-- Add DOT permit columns to user_parked_vehicles for reminder tracking
ALTER TABLE user_parked_vehicles
  ADD COLUMN IF NOT EXISTS dot_permit_active boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS dot_permit_type text,
  ADD COLUMN IF NOT EXISTS dot_permit_start_date text,
  ADD COLUMN IF NOT EXISTS dot_permit_notified_at timestamp with time zone;

-- RLS: dot_permits is read-only public data, no user-specific access needed
-- The table is populated by the sync cron (using service role key)
-- and read by the parking check API (also using service role key)
-- No RLS policies needed since all access goes through supabaseAdmin
ALTER TABLE dot_permits ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (supabaseAdmin)
CREATE POLICY "Service role has full access to dot_permits"
  ON dot_permits
  FOR ALL
  USING (true)
  WITH CHECK (true);
