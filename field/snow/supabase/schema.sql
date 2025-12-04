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

-- ===========================================
-- BATTLE-READY FEATURES (Christmas Launch)
-- ===========================================

-- Shoveler online/offline status
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) NOT NULL,
    customer_phone TEXT NOT NULL,
    shoveler_phone TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    tip_amount NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_shoveler ON reviews(shoveler_phone);
CREATE INDEX IF NOT EXISTS idx_reviews_job ON reviews(job_id);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reviews full access" ON reviews FOR ALL USING (true);

-- Payout requests table
CREATE TABLE IF NOT EXISTS payout_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shoveler_phone TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    venmo_handle TEXT,
    cashapp_handle TEXT,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'rejected')),
    admin_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_payout_requests_phone ON payout_requests(shoveler_phone);
CREATE INDEX IF NOT EXISTS idx_payout_requests_status ON payout_requests(status);
ALTER TABLE payout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Payout requests full access" ON payout_requests FOR ALL USING (true);

-- Storm mode tracking
CREATE TABLE IF NOT EXISTS storm_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    snow_inches NUMERIC NOT NULL,
    surge_multiplier NUMERIC DEFAULT 1.5,
    active BOOLEAN DEFAULT TRUE,
    notified_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

ALTER TABLE storm_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Storm alerts full access" ON storm_alerts FOR ALL USING (true);

-- Leaderboard opt-in for shovelers
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS show_on_leaderboard BOOLEAN DEFAULT FALSE;

-- Add average rating to shovelers (cached)
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS avg_rating NUMERIC DEFAULT 0;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS total_reviews INTEGER DEFAULT 0;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS total_tips NUMERIC DEFAULT 0;

-- Function to update shoveler rating
CREATE OR REPLACE FUNCTION update_shoveler_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE shovelers SET
        avg_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE shoveler_phone = NEW.shoveler_phone),
        total_reviews = (SELECT COUNT(*) FROM reviews WHERE shoveler_phone = NEW.shoveler_phone),
        total_tips = (SELECT COALESCE(SUM(tip_amount), 0) FROM reviews WHERE shoveler_phone = NEW.shoveler_phone)
    WHERE phone = NEW.shoveler_phone;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update rating on review insert
DROP TRIGGER IF EXISTS trigger_update_shoveler_rating ON reviews;
CREATE TRIGGER trigger_update_shoveler_rating
    AFTER INSERT ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION update_shoveler_rating();

-- ===========================================
-- LEADERBOARD VIEW
-- ===========================================
CREATE OR REPLACE VIEW leaderboard_current_storm AS
SELECT
    s.phone,
    LEFT(s.name, 1) || REPEAT('*', LENGTH(s.name) - 1) as display_name,
    s.avg_rating,
    COALESCE(SUM(e.shoveler_payout), 0) as storm_earnings,
    COUNT(e.id) as jobs_completed
FROM shovelers s
LEFT JOIN earnings e ON s.phone = e.shoveler_phone
    AND e.created_at >= NOW() - INTERVAL '48 hours'
WHERE s.show_on_leaderboard = TRUE
GROUP BY s.phone, s.name, s.avg_rating
ORDER BY storm_earnings DESC
LIMIT 10;

-- ===========================================
-- FINAL SIMPLICITY PASS
-- ===========================================

-- Plower profile fields
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS profile_pic_url TEXT;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS tagline TEXT;

-- Customer "cool with teens" preference on jobs
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cool_with_teens BOOLEAN DEFAULT TRUE;

-- Push notification subscription for plowers
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS push_subscription TEXT;

-- Rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    identifier TEXT NOT NULL, -- phone or IP
    action TEXT NOT NULL, -- 'job_post' or 'claim'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON rate_limits(identifier, action, created_at);
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rate limits full access" ON rate_limits FOR ALL USING (true);

-- Clean up old rate limit entries (run daily via cron)
CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '2 hours';
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- AIRBNB/UPWORK POLISH FEATURES
-- ===========================================

-- Chicago neighborhoods list for auto-detection
-- Neighborhoods for jobs and shovelers
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS neighborhood TEXT;

-- Job pictures (before/after)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS pics JSONB DEFAULT '[]'::jsonb;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS after_pic TEXT;

-- Payout tracking
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS paid_out BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS final_price NUMERIC;

-- Plower availability calendar (array of available time slots)
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS availability JSONB DEFAULT '[]'::jsonb;

-- Indexes for browsing
CREATE INDEX IF NOT EXISTS idx_jobs_neighborhood ON jobs(neighborhood) WHERE neighborhood IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shovelers_neighborhood ON shovelers(neighborhood) WHERE neighborhood IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_status_pending ON jobs(status, created_at DESC) WHERE status = 'pending';

-- Expand geo radius for Chicagoland suburbs (update helper function)
CREATE OR REPLACE FUNCTION get_nearby_shovelers(
    job_lat NUMERIC,
    job_long NUMERIC,
    max_distance_miles NUMERIC DEFAULT 15, -- Expanded from 10 to 15 miles for suburbs
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
