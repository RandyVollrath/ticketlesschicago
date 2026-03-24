-- Curb Regulations — Street-level parking restrictions detected via Street View + AI Vision
-- Covers: street cleaning, school zone, tow zone, loading zone, no parking, no standing, etc.
-- Does NOT cover: permit zones (use permit_zone_hours), meters, winter ban, snow routes (existing tables)

CREATE TABLE IF NOT EXISTS public.curb_regulations (
    id BIGSERIAL PRIMARY KEY,

    -- Location: block-level address
    block_address TEXT NOT NULL,              -- e.g., "2100 S ARCHER AVE"
    street_number INTEGER NOT NULL,           -- mid-block number where sign was seen
    street_direction TEXT DEFAULT '',          -- N, S, E, W
    street_name TEXT NOT NULL,                -- e.g., "ARCHER"
    street_type TEXT DEFAULT '',              -- AVE, ST, BLVD, DR, etc.
    block_number INTEGER NOT NULL,            -- hundred-block: 2100, 2200, etc.
    side_of_street TEXT,                      -- 'N', 'S', 'E', 'W', 'odd', 'even', or NULL if unknown

    -- Precise coordinates from Street View panorama
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),

    -- Regulation details
    regulation_type TEXT NOT NULL,            -- 'street_cleaning', 'school_zone', 'tow_zone',
                                             -- 'loading_zone', 'no_parking', 'no_standing',
                                             -- 'no_stopping', 'bus_stop', 'fire_lane',
                                             -- 'handicapped', 'reserved', 'time_limited',
                                             -- 'construction', 'other'
    regulation_subtype TEXT,                  -- e.g., 'residential_permit' under no_parking,
                                             -- 'snow_route' under tow_zone, etc.

    -- Schedule: when does this restriction apply?
    restriction_days TEXT,                    -- 'Mon', 'Mon-Fri', 'Mon-Sat', 'All Days', 'School Days', etc.
    restriction_start_time TEXT,              -- '7am', '8am', etc. (lowercase, matches permit_zone_hours format)
    restriction_end_time TEXT,                -- '9am', '4pm', etc.
    restriction_schedule TEXT,                -- canonical: "Mon 7am-9am Apr 1-Nov 30" or "School Days 7am-4pm"
    restriction_season TEXT,                  -- 'Apr 1-Nov 30', 'Dec 1-Apr 1', 'year_round', NULL

    -- Violation context
    violation_code TEXT,                      -- Chicago violation code if known (e.g., '0964040B' for street cleaning)
    fine_amount INTEGER,                      -- Dollar amount if readable from sign
    is_tow_zone BOOLEAN DEFAULT false,        -- Whether sign indicates towing

    -- Raw sign data
    raw_sign_text TEXT,                       -- exact text from sign as read by AI
    sign_count INTEGER DEFAULT 1,             -- how many signs of this type seen at location

    -- Evidence / provenance
    source TEXT NOT NULL DEFAULT 'gemini_street_view',  -- 'gemini_street_view', 'user_report', 'city_data'
    scan_source TEXT,                         -- what triggered the scan: 'permit_zone', 'school_zone',
                                             -- 'block_scan', 'targeted', etc.
    confidence TEXT DEFAULT 'ai_extracted',   -- 'ai_extracted', 'confirmed', 'manual'
    street_view_url TEXT,                     -- Google Street View URL for verification
    image_urls JSONB DEFAULT '[]'::jsonb,     -- array of captured Street View image URLs

    -- Metadata
    extracted_at TIMESTAMPTZ DEFAULT now(),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- Deduplication: same regulation type on the same block side shouldn't have duplicates
    UNIQUE (block_number, street_direction, street_name, street_type, regulation_type, restriction_schedule, side_of_street)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_curb_reg_block
    ON public.curb_regulations (block_number, street_direction, street_name);

CREATE INDEX IF NOT EXISTS idx_curb_reg_type
    ON public.curb_regulations (regulation_type);

CREATE INDEX IF NOT EXISTS idx_curb_reg_location
    ON public.curb_regulations (latitude, longitude);

CREATE INDEX IF NOT EXISTS idx_curb_reg_street
    ON public.curb_regulations (street_direction, street_name, street_type);

CREATE INDEX IF NOT EXISTS idx_curb_reg_confidence
    ON public.curb_regulations (confidence);

CREATE INDEX IF NOT EXISTS idx_curb_reg_source
    ON public.curb_regulations (scan_source);

-- RLS
ALTER TABLE public.curb_regulations ENABLE ROW LEVEL SECURITY;

-- Public read (anonymous users can query regulations for their block)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'curb_regulations' AND policyname = 'Public read curb_regulations'
    ) THEN
        CREATE POLICY "Public read curb_regulations"
            ON public.curb_regulations FOR SELECT
            USING (true);
    END IF;
END $$;

-- Service role full access for the collection script
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'curb_regulations' AND policyname = 'Service role full access on curb_regulations'
    ) THEN
        CREATE POLICY "Service role full access on curb_regulations"
            ON public.curb_regulations FOR ALL
            USING (auth.role() = 'service_role');
    END IF;
END $$;

-- RPC: look up curb regulations for a given address
CREATE OR REPLACE FUNCTION get_curb_regulations(
    p_street_number TEXT,
    p_street_direction TEXT,
    p_street_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_block_number INTEGER;
    v_result JSONB;
BEGIN
    -- Round to hundred-block
    v_block_number := (CAST(p_street_number AS INTEGER) / 100) * 100;

    SELECT jsonb_agg(
        jsonb_build_object(
            'regulation_type', regulation_type,
            'regulation_subtype', regulation_subtype,
            'restriction_schedule', restriction_schedule,
            'restriction_days', restriction_days,
            'restriction_start_time', restriction_start_time,
            'restriction_end_time', restriction_end_time,
            'restriction_season', restriction_season,
            'is_tow_zone', is_tow_zone,
            'fine_amount', fine_amount,
            'violation_code', violation_code,
            'side_of_street', side_of_street,
            'raw_sign_text', raw_sign_text,
            'confidence', confidence,
            'latitude', latitude,
            'longitude', longitude,
            'street_view_url', street_view_url
        )
    )
    INTO v_result
    FROM public.curb_regulations
    WHERE block_number = v_block_number
      AND UPPER(street_direction) = UPPER(p_street_direction)
      AND UPPER(street_name) = UPPER(p_street_name);

    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMENT ON TABLE public.curb_regulations IS
    'Curb-level parking regulations detected via Street View + AI Vision pipeline. '
    'Covers street cleaning signs, school zone restrictions, tow zones, loading zones, '
    'no parking/standing/stopping, and other posted curb regulations. '
    'Does NOT include permit zones (permit_zone_hours), meters, winter ban, or snow routes.';
