-- FOIA Contested Tickets Data
-- Source: Chicago Dept of Administrative Hearings FOIA Response
-- 1.2M contested ticket records from 2019-present

-- Main contested tickets table
CREATE TABLE IF NOT EXISTS contested_tickets_foia (
    id BIGSERIAL PRIMARY KEY,

    -- Ticket identification
    ticket_number TEXT NOT NULL,

    -- Violation details
    violation_date TIMESTAMP,
    violation_code TEXT,
    violation_description TEXT,

    -- Location
    street_number TEXT,
    street_direction TEXT,
    street_name TEXT,
    ward TEXT,

    -- Hearing information
    disposition_date TIMESTAMP,
    contest_type TEXT, -- Mail, In-Person, Virtual In-Person, Continue
    hearing_officer TEXT,
    hearing_location TEXT,

    -- Outcome
    disposition TEXT, -- Not Liable, Liable, Denied, Withdrawn, Stricken
    reason TEXT,
    notes TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),

    -- Indexes for fast querying
    CONSTRAINT contested_tickets_foia_unique UNIQUE (ticket_number, disposition_date)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_contested_violation_code ON contested_tickets_foia(violation_code);
CREATE INDEX IF NOT EXISTS idx_contested_disposition ON contested_tickets_foia(disposition);
CREATE INDEX IF NOT EXISTS idx_contested_contest_type ON contested_tickets_foia(contest_type);
CREATE INDEX IF NOT EXISTS idx_contested_hearing_officer ON contested_tickets_foia(hearing_officer);
CREATE INDEX IF NOT EXISTS idx_contested_reason ON contested_tickets_foia(reason);
CREATE INDEX IF NOT EXISTS idx_contested_ward ON contested_tickets_foia(ward);
CREATE INDEX IF NOT EXISTS idx_contested_violation_date ON contested_tickets_foia(violation_date);
CREATE INDEX IF NOT EXISTS idx_contested_disposition_date ON contested_tickets_foia(disposition_date);

-- Composite indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_contested_code_disposition ON contested_tickets_foia(violation_code, disposition);
CREATE INDEX IF NOT EXISTS idx_contested_officer_disposition ON contested_tickets_foia(hearing_officer, disposition);
CREATE INDEX IF NOT EXISTS idx_contested_contest_type_disposition ON contested_tickets_foia(contest_type, disposition);

-- Materialized view for win rate statistics by violation code
CREATE MATERIALIZED VIEW IF NOT EXISTS violation_win_rates AS
SELECT
    violation_code,
    violation_description,
    COUNT(*) as total_contests,
    COUNT(*) FILTER (WHERE disposition = 'Not Liable') as wins,
    COUNT(*) FILTER (WHERE disposition = 'Liable') as losses,
    COUNT(*) FILTER (WHERE disposition = 'Denied') as denied,
    COUNT(*) FILTER (WHERE disposition IN ('Withdrawn', 'Stricken')) as other,
    ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as win_rate_percent,
    ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*) FILTER (WHERE disposition IN ('Not Liable', 'Liable')), 0), 2) as win_rate_decided_percent
FROM contested_tickets_foia
WHERE violation_code IS NOT NULL
GROUP BY violation_code, violation_description
HAVING COUNT(*) >= 10  -- Only include violations with 10+ contests
ORDER BY total_contests DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_violation_win_rates_code ON violation_win_rates(violation_code);

-- Materialized view for win rates by hearing officer
CREATE MATERIALIZED VIEW IF NOT EXISTS officer_win_rates AS
SELECT
    hearing_officer,
    COUNT(*) as total_cases,
    COUNT(*) FILTER (WHERE disposition = 'Not Liable') as not_liable,
    COUNT(*) FILTER (WHERE disposition = 'Liable') as liable,
    ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as not_liable_rate_percent
FROM contested_tickets_foia
WHERE hearing_officer IS NOT NULL AND hearing_officer != ''
GROUP BY hearing_officer
HAVING COUNT(*) >= 100  -- Only include officers with 100+ cases
ORDER BY total_cases DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_officer_win_rates_officer ON officer_win_rates(hearing_officer);

-- Materialized view for win rates by contest method
CREATE MATERIALIZED VIEW IF NOT EXISTS contest_method_win_rates AS
SELECT
    contest_type,
    COUNT(*) as total_contests,
    COUNT(*) FILTER (WHERE disposition = 'Not Liable') as wins,
    ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as win_rate_percent
FROM contested_tickets_foia
WHERE contest_type IS NOT NULL
GROUP BY contest_type
ORDER BY total_contests DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_method_win_rates_type ON contest_method_win_rates(contest_type);

-- Materialized view for win rates by ward
CREATE MATERIALIZED VIEW IF NOT EXISTS ward_win_rates AS
SELECT
    ward,
    COUNT(*) as total_contests,
    COUNT(*) FILTER (WHERE disposition = 'Not Liable') as wins,
    ROUND(100.0 * COUNT(*) FILTER (WHERE disposition = 'Not Liable') / NULLIF(COUNT(*), 0), 2) as win_rate_percent
FROM contested_tickets_foia
WHERE ward IS NOT NULL AND ward != ''
GROUP BY ward
HAVING COUNT(*) >= 50
ORDER BY ward::INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ward_win_rates_ward ON ward_win_rates(ward);

-- Materialized view for most common dismissal reasons
CREATE MATERIALIZED VIEW IF NOT EXISTS dismissal_reasons AS
SELECT
    reason,
    COUNT(*) as count,
    ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM contested_tickets_foia
WHERE disposition = 'Not Liable' AND reason IS NOT NULL
GROUP BY reason
ORDER BY count DESC;

CREATE INDEX IF NOT EXISTS idx_dismissal_reasons_reason ON dismissal_reasons(reason);

-- Function to refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_foia_statistics()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY violation_win_rates;
    REFRESH MATERIALIZED VIEW CONCURRENTLY officer_win_rates;
    REFRESH MATERIALIZED VIEW CONCURRENTLY contest_method_win_rates;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ward_win_rates;
    REFRESH MATERIALIZED VIEW CONCURRENTLY dismissal_reasons;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (RLS) - Make FOIA data publicly readable since it's public records
ALTER TABLE contested_tickets_foia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "FOIA data is publicly readable" ON contested_tickets_foia
    FOR SELECT
    USING (true);

-- Grant read access to authenticated and anonymous users
GRANT SELECT ON contested_tickets_foia TO authenticated, anon;
GRANT SELECT ON violation_win_rates TO authenticated, anon;
GRANT SELECT ON officer_win_rates TO authenticated, anon;
GRANT SELECT ON contest_method_win_rates TO authenticated, anon;
GRANT SELECT ON ward_win_rates TO authenticated, anon;
GRANT SELECT ON dismissal_reasons TO authenticated, anon;

-- Comments for documentation
COMMENT ON TABLE contested_tickets_foia IS 'Chicago contested parking/traffic tickets from DOAH FOIA response, 2019-present. 1.2M records of administrative hearing outcomes.';
COMMENT ON COLUMN contested_tickets_foia.ticket_number IS 'City of Chicago ticket/citation number';
COMMENT ON COLUMN contested_tickets_foia.contest_type IS 'How ticket was contested: Mail, In-Person, Virtual In-Person, Continue';
COMMENT ON COLUMN contested_tickets_foia.disposition IS 'Hearing outcome: Not Liable, Liable, Denied, Withdrawn, Stricken';
COMMENT ON COLUMN contested_tickets_foia.reason IS 'Reason for decision (e.g., "Prima Facie Case Not Established by City")';
