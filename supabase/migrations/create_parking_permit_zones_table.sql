-- Create table for Chicago parking permit zones
-- This data is cached from https://data.cityofchicago.org/Transportation/Parking-Permit-Zones/u9xt-hiju

CREATE TABLE IF NOT EXISTS parking_permit_zones (
  id BIGSERIAL PRIMARY KEY,
  row_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL,
  zone TEXT NOT NULL,
  odd_even TEXT, -- 'O' for odd, 'E' for even, or NULL for both
  address_range_low INTEGER NOT NULL,
  address_range_high INTEGER NOT NULL,
  street_direction TEXT, -- N, S, E, W
  street_name TEXT NOT NULL,
  street_type TEXT, -- ST, AVE, BLVD, etc.
  buffer TEXT,
  ward_low INTEGER,
  ward_high INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast address lookups
CREATE INDEX IF NOT EXISTS idx_permit_zones_street_name ON parking_permit_zones(street_name);
CREATE INDEX IF NOT EXISTS idx_permit_zones_status ON parking_permit_zones(status);
CREATE INDEX IF NOT EXISTS idx_permit_zones_street_composite ON parking_permit_zones(street_direction, street_name, street_type, status);

-- Create metadata table to track when data was last synced
CREATE TABLE IF NOT EXISTS parking_permit_zones_sync (
  id SERIAL PRIMARY KEY,
  last_synced_at TIMESTAMPTZ NOT NULL,
  total_records INTEGER NOT NULL,
  sync_status TEXT NOT NULL, -- 'success' or 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add comment
COMMENT ON TABLE parking_permit_zones IS 'Cached parking permit zone data from Chicago Open Data portal. Updated periodically via sync script.';
