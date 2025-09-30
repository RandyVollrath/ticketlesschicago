-- Fix TicketlessAmerica street_cleaning_schedule table structure
-- Run this in: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql

-- Enable PostGIS extension FIRST (required for geometry types)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Drop and recreate table with exact same structure as MSC
DROP TABLE IF EXISTS street_cleaning_schedule CASCADE;

CREATE TABLE street_cleaning_schedule (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  section TEXT,
  street_name TEXT,
  side TEXT,
  cleaning_date DATE,
  ward TEXT,
  east_block TEXT,
  west_block TEXT,
  north_block TEXT,
  south_block TEXT,
  east_street TEXT,
  east_block_number TEXT,
  east_direction TEXT,
  west_street TEXT,
  west_block_number TEXT,
  west_direction TEXT,
  north_street TEXT,
  north_block_number TEXT,
  north_direction TEXT,
  south_street TEXT,
  south_block_number TEXT,
  south_direction TEXT,
  ward_section TEXT,
  geom GEOMETRY,
  geom_simplified GEOMETRY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX idx_ward_section_date ON street_cleaning_schedule(ward, section, cleaning_date);
CREATE INDEX idx_cleaning_date ON street_cleaning_schedule(cleaning_date);
CREATE INDEX idx_geom_simplified ON street_cleaning_schedule USING GIST (geom_simplified);

-- Disable RLS for import
ALTER TABLE street_cleaning_schedule DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE street_cleaning_schedule IS 'Chicago street cleaning schedule with geometry data - synced from MSC';