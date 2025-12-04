-- SnowSOS Migration: Round 2 Features
-- Storm Mode, Backup Plowers, Cancellation Fees, Referrals, Scheduled Jobs

-- ===========================================
-- 1. STORM EVENTS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS storm_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    forecast_inches NUMERIC NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    surge_multiplier NUMERIC DEFAULT 1.0,
    is_active BOOLEAN DEFAULT TRUE,
    notified_plowers BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storm_events_active ON storm_events(is_active, start_time, end_time);
ALTER TABLE storm_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Storm events full access" ON storm_events FOR ALL USING (true);

-- ===========================================
-- 2. BACKUP PLOWER FIELDS ON JOBS
-- ===========================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS backup_plower_id UUID REFERENCES shovelers(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS backup_assigned_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS backup_bonus NUMERIC DEFAULT 10;

-- ===========================================
-- 3. CANCELLATION FEE FIELDS
-- ===========================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_fee NUMERIC DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancellation_fee_paid BOOLEAN DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS cancelled_by TEXT CHECK (cancelled_by IN ('customer', 'plower', 'system'));

-- ===========================================
-- 4. SCHEDULED JOBS FIELDS
-- ===========================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS flexibility_minutes INTEGER DEFAULT 60;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS schedule_notified BOOLEAN DEFAULT FALSE;

-- Update status constraint to include 'scheduled'
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
    CHECK (status IN (
        'pending', 'open', 'scheduled', 'accepted', 'on_the_way', 'in_progress',
        'completed', 'cancelled', 'cancelled_by_customer',
        'cancelled_by_plower', 'auto_unassigned'
    ));

-- ===========================================
-- 5. REFERRAL CODES TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('customer', 'plower')),
    owner_id TEXT NOT NULL, -- phone for customer, shoveler.id for plower
    credit_amount NUMERIC DEFAULT 15,
    uses_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON referral_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_codes_owner ON referral_codes(owner_type, owner_id);
ALTER TABLE referral_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Referral codes full access" ON referral_codes FOR ALL USING (true);

-- ===========================================
-- 6. REFERRAL CREDITS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS referral_credits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_type TEXT NOT NULL CHECK (owner_type IN ('customer', 'plower')),
    owner_id TEXT NOT NULL,
    job_id UUID REFERENCES jobs(id),
    amount NUMERIC NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('signup_bonus', 'referred_job', 'plower_milestone')),
    redeemed BOOLEAN DEFAULT FALSE,
    redeemed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_credits_owner ON referral_credits(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_referral_credits_unredeemed ON referral_credits(owner_id, redeemed) WHERE redeemed = FALSE;
ALTER TABLE referral_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Referral credits full access" ON referral_credits FOR ALL USING (true);

-- ===========================================
-- 7. CUSTOMER REFERRAL TRACKING
-- ===========================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS referred_by_code TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- ===========================================
-- 8. PLOWER REFERRAL TRACKING
-- ===========================================

ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS referred_by_id UUID REFERENCES shovelers(id);
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE;

-- ===========================================
-- 9. HELPER FUNCTION: Calculate Surge Multiplier
-- ===========================================

CREATE OR REPLACE FUNCTION calculate_surge_multiplier(inches NUMERIC)
RETURNS NUMERIC AS $$
BEGIN
    IF inches >= 10 THEN
        RETURN 2.0;
    ELSIF inches >= 6 THEN
        RETURN 1.5;
    ELSIF inches >= 4 THEN
        RETURN 1.2;
    ELSE
        RETURN 1.0;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- 10. HELPER FUNCTION: Generate Referral Code
-- ===========================================

CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    result TEXT := 'SNOW';
    i INTEGER;
BEGIN
    FOR i IN 1..4 LOOP
        result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 11. INDEXES FOR SCHEDULED JOBS
-- ===========================================

CREATE INDEX IF NOT EXISTS idx_jobs_scheduled ON jobs(scheduled_for)
    WHERE status = 'scheduled' AND scheduled_for IS NOT NULL;

-- ===========================================
-- 12. COMMENTS
-- ===========================================

COMMENT ON TABLE storm_events IS 'Weather-triggered storm events with surge pricing';
COMMENT ON TABLE referral_codes IS 'Referral codes for customers and plowers';
COMMENT ON TABLE referral_credits IS 'Credit earned from referrals';
COMMENT ON FUNCTION calculate_surge_multiplier IS 'Calculate surge based on forecast inches';
