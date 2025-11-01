-- Create table for Chicago towed vehicles
-- Data from: https://data.cityofchicago.org/Transportation/Towed-Vehicles/ygr5-vcbg

CREATE TABLE IF NOT EXISTS towed_vehicles (
  id SERIAL PRIMARY KEY,
  tow_date TIMESTAMP WITH TIME ZONE NOT NULL,
  make TEXT,
  style TEXT,
  color TEXT,
  plate TEXT NOT NULL,
  state TEXT,
  towed_to_address TEXT,
  tow_facility_phone TEXT,
  inventory_number TEXT UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notified_users TEXT[] DEFAULT '{}' -- Track which users we've notified about this tow
);

-- Index for fast plate lookups
CREATE INDEX IF NOT EXISTS idx_towed_plate ON towed_vehicles(plate);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_towed_date ON towed_vehicles(tow_date DESC);

-- Composite index for user monitoring queries
CREATE INDEX IF NOT EXISTS idx_towed_plate_date ON towed_vehicles(plate, tow_date DESC);

-- Index for inventory number uniqueness
CREATE INDEX IF NOT EXISTS idx_towed_inventory ON towed_vehicles(inventory_number);
