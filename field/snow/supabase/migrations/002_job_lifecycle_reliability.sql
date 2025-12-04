-- SnowSOS Migration: Job Lifecycle, Reliability & Incentives
-- Run this in your Supabase SQL Editor

-- ===========================================
-- 1. JOB LIFECYCLE COLUMNS
-- ===========================================

-- Add plower_id reference (UUID instead of phone for better relations)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS plower_id UUID REFERENCES shovelers(id);

-- Job lifecycle timestamps
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS on_the_way_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS broadcasted_at TIMESTAMPTZ;

-- Update status constraint for new statuses
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN (
        'pending', 'open', 'accepted', 'on_the_way', 'in_progress',
        'completed', 'cancelled', 'cancelled_by_customer',
        'cancelled_by_plower', 'auto_unassigned'
    ));

-- Migrate existing 'pending' to 'open' for consistency
UPDATE jobs SET status = 'open' WHERE status = 'pending';

-- ===========================================
-- 2. PLOWER RELIABILITY TRACKING
-- ===========================================

ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS jobs_claimed INTEGER DEFAULT 0;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS jobs_completed INTEGER DEFAULT 0;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS jobs_cancelled_by_plower INTEGER DEFAULT 0;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS no_show_strikes INTEGER DEFAULT 0;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS id_document_url TEXT;

-- Create index for reliability queries
CREATE INDEX IF NOT EXISTS idx_shovelers_reliability
    ON shovelers(jobs_completed, jobs_claimed, no_show_strikes);

-- ===========================================
-- 3. BONUSES TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS bonuses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plower_id UUID REFERENCES shovelers(id) NOT NULL,
    job_id UUID REFERENCES jobs(id) NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('fast_response', 'perfect_storm', 'reliability', 'first_job')),
    amount NUMERIC NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonuses_plower ON bonuses(plower_id);
CREATE INDEX IF NOT EXISTS idx_bonuses_job ON bonuses(job_id);
CREATE INDEX IF NOT EXISTS idx_bonuses_created ON bonuses(created_at DESC);

ALTER TABLE bonuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Bonuses full access" ON bonuses FOR ALL USING (true);

-- ===========================================
-- 4. DISPUTES TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES jobs(id) NOT NULL,
    customer_phone TEXT NOT NULL,
    plower_id UUID REFERENCES shovelers(id),
    reason TEXT NOT NULL,
    photos JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'resolved')),
    admin_notes TEXT,
    resolution TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);
CREATE INDEX IF NOT EXISTS idx_disputes_customer ON disputes(customer_phone);

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Disputes full access" ON disputes FOR ALL USING (true);

-- ===========================================
-- 5. HELPER FUNCTIONS
-- ===========================================

-- Calculate reliability score
CREATE OR REPLACE FUNCTION calculate_reliability_score(
    p_jobs_completed INTEGER,
    p_jobs_claimed INTEGER
) RETURNS NUMERIC AS $$
BEGIN
    IF p_jobs_claimed IS NULL OR p_jobs_claimed = 0 THEN
        RETURN 1.0; -- New plowers start with 100% reliability
    END IF;
    RETURN ROUND((p_jobs_completed::NUMERIC / p_jobs_claimed::NUMERIC), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Calculate plower tier
CREATE OR REPLACE FUNCTION calculate_plower_tier(
    p_jobs_completed INTEGER,
    p_reliability_score NUMERIC
) RETURNS TEXT AS $$
BEGIN
    IF p_jobs_completed >= 100 AND p_reliability_score >= 0.9 THEN
        RETURN 'diamond';
    ELSIF p_jobs_completed >= 50 THEN
        RETURN 'gold';
    ELSIF p_jobs_completed >= 10 THEN
        RETURN 'silver';
    ELSE
        RETURN 'bronze';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- 6. UPDATE get_nearby_shovelers TO INCLUDE RELIABILITY
-- ===========================================

DROP FUNCTION IF EXISTS get_nearby_shovelers(NUMERIC, NUMERIC, NUMERIC, NUMERIC);

CREATE OR REPLACE FUNCTION get_nearby_shovelers(
    job_lat NUMERIC,
    job_long NUMERIC,
    max_distance_miles NUMERIC DEFAULT 15,
    max_rate NUMERIC DEFAULT NULL
) RETURNS TABLE (
    id UUID,
    phone TEXT,
    name TEXT,
    rate NUMERIC,
    skills TEXT[],
    distance_miles NUMERIC,
    has_truck BOOLEAN,
    is_online BOOLEAN,
    reliability_score NUMERIC,
    tier TEXT,
    no_show_strikes INTEGER,
    is_verified BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        s.id,
        s.phone,
        s.name,
        s.rate,
        s.skills,
        haversine_distance(job_lat, job_long, s.lat, s.long) as distance_miles,
        s.has_truck,
        s.is_online,
        calculate_reliability_score(s.jobs_completed, s.jobs_claimed) as reliability_score,
        calculate_plower_tier(
            s.jobs_completed,
            calculate_reliability_score(s.jobs_completed, s.jobs_claimed)
        ) as tier,
        s.no_show_strikes,
        s.is_verified
    FROM shovelers s
    WHERE s.active = true
        AND s.lat IS NOT NULL
        AND s.long IS NOT NULL
        AND s.no_show_strikes < 3 -- Exclude suspended plowers
        AND haversine_distance(job_lat, job_long, s.lat, s.long) <= max_distance_miles
        AND (max_rate IS NULL OR s.rate <= max_rate)
    ORDER BY
        -- Prioritize by tier (diamond/gold first)
        CASE calculate_plower_tier(
            s.jobs_completed,
            calculate_reliability_score(s.jobs_completed, s.jobs_claimed)
        )
            WHEN 'diamond' THEN 1
            WHEN 'gold' THEN 2
            WHEN 'silver' THEN 3
            ELSE 4
        END,
        -- Then by reliability score
        calculate_reliability_score(s.jobs_completed, s.jobs_claimed) DESC,
        -- Then by distance
        distance_miles ASC;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 7. TRIGGERS FOR STATS UPDATES
-- ===========================================

-- Function to update plower stats when job status changes
CREATE OR REPLACE FUNCTION update_plower_job_stats()
RETURNS TRIGGER AS $$
BEGIN
    -- Job was just claimed
    IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status = 'open') THEN
        UPDATE shovelers
        SET jobs_claimed = jobs_claimed + 1
        WHERE id = NEW.plower_id;
    END IF;

    -- Job was completed
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        UPDATE shovelers
        SET jobs_completed = jobs_completed + 1
        WHERE id = NEW.plower_id;
    END IF;

    -- Job was cancelled by plower
    IF NEW.status = 'cancelled_by_plower' AND OLD.status != 'cancelled_by_plower' THEN
        UPDATE shovelers
        SET jobs_cancelled_by_plower = jobs_cancelled_by_plower + 1
        WHERE id = NEW.plower_id;
    END IF;

    -- Job was auto-unassigned (no-show)
    IF NEW.status = 'auto_unassigned' AND OLD.status != 'auto_unassigned' THEN
        UPDATE shovelers
        SET no_show_strikes = no_show_strikes + 1
        WHERE id = OLD.plower_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_plower_stats ON jobs;
CREATE TRIGGER trigger_update_plower_stats
    AFTER UPDATE ON jobs
    FOR EACH ROW
    EXECUTE FUNCTION update_plower_job_stats();

-- ===========================================
-- 8. INDEXES FOR CRON JOB
-- ===========================================

-- Index for finding stale accepted jobs
CREATE INDEX IF NOT EXISTS idx_jobs_stale_accepted
    ON jobs(accepted_at)
    WHERE status = 'accepted' AND on_the_way_at IS NULL;

-- Index for finding stale on_the_way jobs
CREATE INDEX IF NOT EXISTS idx_jobs_stale_on_the_way
    ON jobs(on_the_way_at)
    WHERE status = 'on_the_way' AND arrived_at IS NULL;

-- ===========================================
-- 9. COMMENTS
-- ===========================================

COMMENT ON TABLE bonuses IS 'Bonus payments awarded to plowers for fast response, reliability, etc.';
COMMENT ON TABLE disputes IS 'Customer disputes for job quality issues';
COMMENT ON FUNCTION calculate_reliability_score IS 'Calculate plower reliability as completed/claimed ratio';
COMMENT ON FUNCTION calculate_plower_tier IS 'Determine plower tier based on jobs and reliability';
