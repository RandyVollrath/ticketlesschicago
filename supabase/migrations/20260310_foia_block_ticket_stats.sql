-- FOIA Block & ZIP Ticket Stats (26.8M tickets, 2019-2024)
-- Source: FOIA F118906-110325 — all Chicago parking/camera tickets
-- Aggregated by scripts/aggregate-foia-tickets.py

-- ============================================================
-- 1. Block-level yearly stats (1.48M rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS foia_block_stats (
    block_id TEXT NOT NULL,              -- e.g., "1700 S CLINTON"
    violation_category TEXT NOT NULL,     -- e.g., "street_cleaning", "expired_meter"
    year INTEGER NOT NULL,
    ticket_count INTEGER NOT NULL DEFAULT 0,
    fines_base REAL NOT NULL DEFAULT 0,
    fines_late REAL NOT NULL DEFAULT 0,
    paid_count INTEGER NOT NULL DEFAULT 0,
    dismissed_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (block_id, violation_category, year)
);

CREATE INDEX IF NOT EXISTS idx_foia_block_stats_block ON foia_block_stats(block_id);
CREATE INDEX IF NOT EXISTS idx_foia_block_stats_year ON foia_block_stats(year);
CREATE INDEX IF NOT EXISTS idx_foia_block_stats_category ON foia_block_stats(violation_category);

-- ============================================================
-- 2. Block-level hourly enforcement patterns (522K rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS foia_block_hourly (
    block_id TEXT NOT NULL,
    violation_category TEXT NOT NULL,
    hour INTEGER NOT NULL,               -- 0-23
    day_of_week INTEGER NOT NULL,        -- 0=Monday, 6=Sunday
    ticket_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (block_id, violation_category, hour, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_foia_block_hourly_block ON foia_block_hourly(block_id);

-- ============================================================
-- 3. Block-level monthly patterns (469K rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS foia_block_monthly (
    block_id TEXT NOT NULL,
    violation_category TEXT NOT NULL,
    month INTEGER NOT NULL,              -- 1-12
    ticket_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (block_id, violation_category, month)
);

CREATE INDEX IF NOT EXISTS idx_foia_block_monthly_block ON foia_block_monthly(block_id);

-- ============================================================
-- 4. ZIP code yearly stats (376K rows)
-- ============================================================
CREATE TABLE IF NOT EXISTS foia_zip_stats (
    zip_code TEXT NOT NULL,
    violation_category TEXT NOT NULL,
    year INTEGER NOT NULL,
    ticket_count INTEGER NOT NULL DEFAULT 0,
    fines_base REAL NOT NULL DEFAULT 0,
    paid_count INTEGER NOT NULL DEFAULT 0,
    dismissed_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (zip_code, violation_category, year)
);

CREATE INDEX IF NOT EXISTS idx_foia_zip_stats_zip ON foia_zip_stats(zip_code);
CREATE INDEX IF NOT EXISTS idx_foia_zip_stats_year ON foia_zip_stats(year);

-- ============================================================
-- RLS: publicly readable (aggregate public records data)
-- ============================================================
ALTER TABLE foia_block_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE foia_block_hourly ENABLE ROW LEVEL SECURITY;
ALTER TABLE foia_block_monthly ENABLE ROW LEVEL SECURITY;
ALTER TABLE foia_zip_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "foia_block_stats_public_read" ON foia_block_stats FOR SELECT USING (true);
CREATE POLICY "foia_block_hourly_public_read" ON foia_block_hourly FOR SELECT USING (true);
CREATE POLICY "foia_block_monthly_public_read" ON foia_block_monthly FOR SELECT USING (true);
CREATE POLICY "foia_zip_stats_public_read" ON foia_zip_stats FOR SELECT USING (true);

GRANT SELECT ON foia_block_stats TO authenticated, anon;
GRANT SELECT ON foia_block_hourly TO authenticated, anon;
GRANT SELECT ON foia_block_monthly TO authenticated, anon;
GRANT SELECT ON foia_zip_stats TO authenticated, anon;

-- ============================================================
-- RPC: Get block ticket summary for a given address
-- Returns aggregated stats across all years + violation breakdown
-- ============================================================
CREATE OR REPLACE FUNCTION get_block_ticket_summary(
    p_street_number TEXT,
    p_street_direction TEXT,
    p_street_name TEXT
)
RETURNS JSON AS $$
DECLARE
    v_block_number INTEGER;
    v_block_id TEXT;
    v_result JSON;
BEGIN
    -- Compute hundred-block from street number
    v_block_number := (CAST(p_street_number AS INTEGER) / 100) * 100;

    -- Build block_id to match FOIA format: "1700 S CLINTON"
    -- FOIA data does NOT include street type (ST/AVE/etc.)
    v_block_id := v_block_number::TEXT;
    IF TRIM(p_street_direction) != '' THEN
        v_block_id := v_block_id || ' ' || UPPER(TRIM(p_street_direction));
    END IF;
    v_block_id := v_block_id || ' ' || UPPER(TRIM(p_street_name));

    SELECT json_build_object(
        'block_id', v_block_id,
        'total_tickets', COALESCE(agg.total_tickets, 0),
        'total_fines', COALESCE(agg.total_fines, 0),
        'total_paid', COALESCE(agg.total_paid, 0),
        'total_dismissed', COALESCE(agg.total_dismissed, 0),
        'years_covered', COALESCE(agg.years_covered, '[]'::json),
        'by_category', COALESCE(cats.breakdown, '[]'::json),
        'by_year', COALESCE(yrs.yearly, '[]'::json),
        'peak_hours', COALESCE(hrs.peak, '[]'::json),
        'monthly_pattern', COALESCE(mos.monthly, '[]'::json)
    ) INTO v_result
    FROM (
        -- Totals
        SELECT
            SUM(ticket_count) AS total_tickets,
            ROUND(SUM(fines_base)::numeric, 0) AS total_fines,
            SUM(paid_count) AS total_paid,
            SUM(dismissed_count) AS total_dismissed,
            json_agg(DISTINCT year ORDER BY year) AS years_covered
        FROM foia_block_stats
        WHERE block_id = v_block_id
    ) agg
    CROSS JOIN LATERAL (
        -- By category
        SELECT json_agg(json_build_object(
            'category', sub.violation_category,
            'tickets', sub.cnt,
            'fines', sub.fns
        ) ORDER BY sub.cnt DESC) AS breakdown
        FROM (
            SELECT violation_category, SUM(ticket_count) AS cnt, ROUND(SUM(fines_base)::numeric, 0) AS fns
            FROM foia_block_stats WHERE block_id = v_block_id
            GROUP BY violation_category
        ) sub
    ) cats
    CROSS JOIN LATERAL (
        -- By year
        SELECT json_agg(json_build_object(
            'year', sub.year,
            'tickets', sub.cnt,
            'fines', sub.fns
        ) ORDER BY sub.year) AS yearly
        FROM (
            SELECT year, SUM(ticket_count) AS cnt, ROUND(SUM(fines_base)::numeric, 0) AS fns
            FROM foia_block_stats WHERE block_id = v_block_id
            GROUP BY year
        ) sub
    ) yrs
    CROSS JOIN LATERAL (
        -- Peak hours (top 6 hours by total tickets)
        SELECT json_agg(json_build_object(
            'hour', sub.hour,
            'day_of_week', sub.day_of_week,
            'tickets', sub.cnt
        ) ORDER BY sub.cnt DESC) AS peak
        FROM (
            SELECT hour, day_of_week, SUM(ticket_count) AS cnt
            FROM foia_block_hourly WHERE block_id = v_block_id
            GROUP BY hour, day_of_week
            ORDER BY cnt DESC
            LIMIT 12
        ) sub
    ) hrs
    CROSS JOIN LATERAL (
        -- Monthly pattern
        SELECT json_agg(json_build_object(
            'month', sub.month,
            'tickets', sub.cnt
        ) ORDER BY sub.month) AS monthly
        FROM (
            SELECT month, SUM(ticket_count) AS cnt
            FROM foia_block_monthly WHERE block_id = v_block_id
            GROUP BY month
        ) sub
    ) mos;

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'block_id', COALESCE(v_block_id, ''),
        'total_tickets', 0,
        'total_fines', 0,
        'error', SQLERRM
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- RPC: Get ZIP code ticket summary
-- ============================================================
CREATE OR REPLACE FUNCTION get_zip_ticket_summary(p_zip_code TEXT)
RETURNS JSON AS $$
DECLARE
    v_result JSON;
BEGIN
    SELECT json_build_object(
        'zip_code', p_zip_code,
        'total_tickets', COALESCE(agg.total_tickets, 0),
        'total_fines', COALESCE(agg.total_fines, 0),
        'by_category', COALESCE(cats.breakdown, '[]'::json),
        'by_year', COALESCE(yrs.yearly, '[]'::json)
    ) INTO v_result
    FROM (
        SELECT SUM(ticket_count) AS total_tickets, ROUND(SUM(fines_base)::numeric, 0) AS total_fines
        FROM foia_zip_stats WHERE zip_code = p_zip_code
    ) agg
    CROSS JOIN LATERAL (
        SELECT json_agg(json_build_object(
            'category', sub.violation_category,
            'tickets', sub.cnt,
            'fines', sub.fns
        ) ORDER BY sub.cnt DESC) AS breakdown
        FROM (
            SELECT violation_category, SUM(ticket_count) AS cnt, ROUND(SUM(fines_base)::numeric, 0) AS fns
            FROM foia_zip_stats WHERE zip_code = p_zip_code
            GROUP BY violation_category
        ) sub
    ) cats
    CROSS JOIN LATERAL (
        SELECT json_agg(json_build_object(
            'year', sub.year,
            'tickets', sub.cnt,
            'fines', sub.fns
        ) ORDER BY sub.year) AS yearly
        FROM (
            SELECT year, SUM(ticket_count) AS cnt, ROUND(SUM(fines_base)::numeric, 0) AS fns
            FROM foia_zip_stats WHERE zip_code = p_zip_code
            GROUP BY year
        ) sub
    ) yrs;

    RETURN v_result;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON TABLE foia_block_stats IS 'Block-level ticket stats from 26.8M FOIA tickets (2019-2024). Block IDs are hundred-block + direction + street name (no type). Source: FOIA F118906-110325.';
COMMENT ON TABLE foia_block_hourly IS 'Hourly enforcement patterns per block. Only includes block/category/hour/dow combos with 5+ tickets. Source: FOIA F118906-110325.';
COMMENT ON TABLE foia_block_monthly IS 'Monthly enforcement patterns per block. Only includes block/category/month combos with 5+ tickets. Source: FOIA F118906-110325.';
COMMENT ON TABLE foia_zip_stats IS 'ZIP code ticket stats from 26.8M FOIA tickets (2019-2024). Source: FOIA F118906-110325.';
