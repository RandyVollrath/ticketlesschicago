-- Block Enforcement Stats
-- Aggregated ticket data per city block from 645K FOIA ticket records
-- Source: tickets_where_and_when_written.xlsx (FOIA response)
-- Contains: ticket counts, estimated revenue, violation breakdown,
--           hourly/dow enforcement patterns, peak windows

CREATE TABLE IF NOT EXISTS block_enforcement_stats (
    id BIGSERIAL PRIMARY KEY,

    -- Block identification (hundred-block level)
    block_address TEXT NOT NULL UNIQUE,         -- e.g., "2100 S ARCHER AVE"
    street_direction TEXT DEFAULT '',           -- e.g., "S"
    street_name TEXT NOT NULL,                  -- e.g., "ARCHER AVE"
    block_number INTEGER NOT NULL,             -- e.g., 2100

    -- Aggregate stats
    total_tickets INTEGER NOT NULL DEFAULT 0,
    estimated_revenue INTEGER NOT NULL DEFAULT 0,  -- sum of fine amounts in dollars
    city_rank INTEGER,                             -- 1 = most ticketed block

    -- Violation breakdown (JSONB: { "0964040B": { count: 500, revenue: 30000, description: "STREET CLEANING" } })
    violation_breakdown JSONB DEFAULT '{}',

    -- Enforcement patterns
    hourly_histogram INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],  -- 24 elements, index=hour
    dow_histogram INTEGER[] DEFAULT ARRAY[0,0,0,0,0,0,0],  -- 7 elements, 0=Sun
    peak_hour_start INTEGER DEFAULT 0,         -- Start of 3-hour peak window
    peak_hour_end INTEGER DEFAULT 0,           -- End of 3-hour peak window

    -- Top violation
    top_violation_code TEXT,
    top_violation_pct INTEGER DEFAULT 0,       -- Percentage of tickets from top violation

    -- Data range
    year_range TEXT DEFAULT '',                 -- e.g., "2024-2025"

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast lookup during parking checks
CREATE INDEX IF NOT EXISTS idx_block_stats_street ON block_enforcement_stats(street_direction, street_name);
CREATE INDEX IF NOT EXISTS idx_block_stats_block_num ON block_enforcement_stats(block_number);
CREATE INDEX IF NOT EXISTS idx_block_stats_revenue ON block_enforcement_stats(estimated_revenue DESC);
CREATE INDEX IF NOT EXISTS idx_block_stats_rank ON block_enforcement_stats(city_rank);

-- Composite index for the exact lookup pattern used by check-parking API
CREATE INDEX IF NOT EXISTS idx_block_stats_lookup
    ON block_enforcement_stats(block_number, street_direction, street_name);

-- RLS: publicly readable (aggregate public records data)
ALTER TABLE block_enforcement_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Block enforcement stats are publicly readable"
    ON block_enforcement_stats FOR SELECT USING (true);

GRANT SELECT ON block_enforcement_stats TO authenticated, anon;

-- Function to look up block stats for a parking check
-- Takes a street number, direction, and name and finds the matching block
CREATE OR REPLACE FUNCTION get_block_enforcement_stats(
    p_street_number TEXT,
    p_street_direction TEXT,
    p_street_name TEXT
)
RETURNS TABLE (
    block_address TEXT,
    total_tickets INTEGER,
    estimated_revenue INTEGER,
    city_rank INTEGER,
    violation_breakdown JSONB,
    hourly_histogram INTEGER[],
    dow_histogram INTEGER[],
    peak_hour_start INTEGER,
    peak_hour_end INTEGER,
    top_violation_code TEXT,
    top_violation_pct INTEGER,
    year_range TEXT
) AS $$
DECLARE
    v_block_number INTEGER;
    v_direction TEXT;
    v_name TEXT;
BEGIN
    -- Compute hundred-block from street number
    v_block_number := (CAST(p_street_number AS INTEGER) / 100) * 100;
    v_direction := UPPER(TRIM(p_street_direction));
    v_name := UPPER(TRIM(p_street_name));

    RETURN QUERY
    SELECT
        b.block_address,
        b.total_tickets,
        b.estimated_revenue,
        b.city_rank,
        b.violation_breakdown,
        b.hourly_histogram,
        b.dow_histogram,
        b.peak_hour_start,
        b.peak_hour_end,
        b.top_violation_code,
        b.top_violation_pct,
        b.year_range
    FROM block_enforcement_stats b
    WHERE b.block_number = v_block_number
      AND b.street_direction = v_direction
      AND b.street_name = v_name
    LIMIT 1;

EXCEPTION WHEN OTHERS THEN
    -- If street number isn't a valid integer, return nothing
    RETURN;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON TABLE block_enforcement_stats IS 'Block-level parking ticket aggregations from FOIA data. ~20K blocks with ticket counts, estimated revenue, and enforcement patterns.';
COMMENT ON COLUMN block_enforcement_stats.estimated_revenue IS 'Estimated total fine revenue in USD, calculated as ticket_count × fine_per_violation_code. Not actual city collections (some tickets are contested/unpaid).';
COMMENT ON COLUMN block_enforcement_stats.city_rank IS '1 = block with most tickets citywide. Used in UI: "This block ranks #18 citywide for tickets."';
