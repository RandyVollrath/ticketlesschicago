-- SnowSOS Enhanced Schema
-- Run this in your Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===========================================
-- MIGRATION: Add new columns to existing tables
-- ===========================================

-- Add columns to customers (if not exist)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;

-- Add columns to shovelers
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS rate NUMERIC DEFAULT 50;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT ARRAY['shovel'];
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS long NUMERIC;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT FALSE;

-- Add columns to jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_price NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS long NUMERIC;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Bidding columns
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bid_mode BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bids JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS bid_deadline TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS selected_bid_index INTEGER;

-- Chat and surge columns
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS chat_history JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS surge_multiplier NUMERIC DEFAULT 1.0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS weather_note TEXT;

-- Service type for truck vs shovel
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS service_type TEXT DEFAULT 'any' CHECK (service_type IN ('truck', 'shovel', 'any'));

-- Auto-complete tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS auto_complete_at TIMESTAMPTZ;

-- Add has_truck and payment info to shovelers
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS has_truck BOOLEAN DEFAULT FALSE;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS venmo_handle TEXT;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS cashapp_handle TEXT;

-- Earnings tracking table
CREATE TABLE IF NOT EXISTS earnings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id),
    shoveler_phone TEXT NOT NULL,
    job_amount NUMERIC NOT NULL,
    platform_fee NUMERIC NOT NULL,
    shoveler_payout NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for earnings
CREATE INDEX IF NOT EXISTS idx_earnings_shoveler ON earnings(shoveler_phone);
CREATE INDEX IF NOT EXISTS idx_earnings_created ON earnings(created_at DESC);

-- Enable RLS on earnings
ALTER TABLE earnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Earnings full access" ON earnings FOR ALL USING (true);

-- Update status constraint to include 'in_progress'
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN ('pending', 'claimed', 'in_progress', 'completed', 'cancelled'));

-- ===========================================
-- INDEXES
-- ===========================================
CREATE INDEX IF NOT EXISTS idx_shovelers_location ON shovelers(lat, long) WHERE lat IS NOT NULL AND long IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(lat, long) WHERE lat IS NOT NULL AND long IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_shoveler_phone ON jobs(shoveler_phone);

-- ===========================================
-- ROW LEVEL SECURITY (RLS)
-- ===========================================

-- Enable RLS on all tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shovelers ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Customers read own" ON customers;
DROP POLICY IF EXISTS "Shovelers read active" ON shovelers;
DROP POLICY IF EXISTS "Shovelers insert" ON shovelers;
DROP POLICY IF EXISTS "Shovelers update own" ON shovelers;
DROP POLICY IF EXISTS "Jobs read pending or own" ON jobs;
DROP POLICY IF EXISTS "Jobs insert" ON jobs;
DROP POLICY IF EXISTS "Jobs update" ON jobs;

-- Customers: Allow all operations (service role)
CREATE POLICY "Customers full access" ON customers FOR ALL USING (true);

-- Shovelers: Allow all operations (service role)
CREATE POLICY "Shovelers full access" ON shovelers FOR ALL USING (true);

-- Jobs: Allow all operations (service role)
CREATE POLICY "Jobs full access" ON jobs FOR ALL USING (true);

-- ===========================================
-- HELPER FUNCTION: Haversine Distance (miles)
-- ===========================================
CREATE OR REPLACE FUNCTION haversine_distance(
    lat1 NUMERIC, long1 NUMERIC,
    lat2 NUMERIC, long2 NUMERIC
) RETURNS NUMERIC AS $$
DECLARE
    r NUMERIC := 3959; -- Earth's radius in miles
    dlat NUMERIC;
    dlong NUMERIC;
    a NUMERIC;
    c NUMERIC;
BEGIN
    IF lat1 IS NULL OR long1 IS NULL OR lat2 IS NULL OR long2 IS NULL THEN
        RETURN NULL;
    END IF;

    dlat := radians(lat2 - lat1);
    dlong := radians(long2 - long1);

    a := sin(dlat/2)^2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlong/2)^2;
    c := 2 * asin(sqrt(a));

    RETURN r * c;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- HELPER FUNCTION: Get nearby shovelers
-- ===========================================
CREATE OR REPLACE FUNCTION get_nearby_shovelers(
    job_lat NUMERIC,
    job_long NUMERIC,
    max_distance_miles NUMERIC DEFAULT 10,
    max_rate NUMERIC DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    phone TEXT,
    name TEXT,
    rate NUMERIC,
    skills TEXT[],
    distance_miles NUMERIC
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.phone,
        s.name,
        s.rate,
        s.skills,
        haversine_distance(job_lat, job_long, s.lat, s.long) as distance_miles
    FROM shovelers s
    WHERE s.active = true
        AND s.lat IS NOT NULL
        AND s.long IS NOT NULL
        AND haversine_distance(job_lat, job_long, s.lat, s.long) <= max_distance_miles
        AND (max_rate IS NULL OR s.rate <= max_rate)
    ORDER BY distance_miles ASC;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- COMMENTS
-- ===========================================
COMMENT ON TABLE customers IS 'Customers who request snow removal';
COMMENT ON TABLE shovelers IS 'Snow removal providers with rates and location';
COMMENT ON TABLE jobs IS 'Snow removal job requests with geo-location';
COMMENT ON FUNCTION haversine_distance IS 'Calculate distance between two points in miles';
COMMENT ON FUNCTION get_nearby_shovelers IS 'Find active shovelers within radius of a job location';
