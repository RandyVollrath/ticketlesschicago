-- Block-level overrides for permit zone enforcement hours.
-- The permit_zone_hours table stores zone-level defaults, but enforcement hours
-- can vary by block within the same zone. This table stores per-block exceptions.
--
-- Lookup priority:
-- 1. permit_zone_block_overrides (block-specific hours)
-- 2. permit_zone_hours (zone-wide default)
-- 3. "hours unknown" fallback

CREATE TABLE IF NOT EXISTS public.permit_zone_block_overrides (
    id BIGSERIAL PRIMARY KEY,
    zone TEXT NOT NULL,                     -- permit zone number (matches permit_zone_hours.zone)
    zone_type TEXT NOT NULL DEFAULT 'residential',  -- 'residential' or 'industrial'
    -- Block address components
    block_number INTEGER NOT NULL,          -- hundred-block: 2100, 2200, etc.
    street_direction TEXT DEFAULT '',        -- N, S, E, W
    street_name TEXT NOT NULL,              -- e.g., "ARCHER"
    street_type TEXT DEFAULT '',            -- AVE, ST, BLVD, etc.
    -- Override schedule
    restriction_schedule TEXT NOT NULL,      -- "Mon-Fri 6am-6pm", "24/7", etc.
    restriction_hours TEXT,                 -- "6am-6pm"
    restriction_days TEXT,                  -- "Mon-Fri"
    -- Provenance
    source TEXT NOT NULL DEFAULT 'user_report',  -- 'user_report', 'ai_extracted', 'foia', 'manual'
    confidence TEXT NOT NULL DEFAULT 'user_reported', -- 'user_reported', 'ai_extracted', 'confirmed'
    reported_by TEXT,                       -- user_id of reporter (nullable for non-user sources)
    raw_sign_text TEXT,                     -- exact text from sign
    photo_url TEXT,                         -- URL to uploaded sign photo
    notes TEXT,
    -- Metadata
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    -- One override per block per zone
    UNIQUE (zone, block_number, street_direction, street_name, street_type)
);

CREATE INDEX IF NOT EXISTS idx_pzbo_zone ON public.permit_zone_block_overrides (zone);
CREATE INDEX IF NOT EXISTS idx_pzbo_block ON public.permit_zone_block_overrides (block_number, street_direction, street_name);

-- RLS
ALTER TABLE public.permit_zone_block_overrides ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permit_zone_block_overrides' AND policyname = 'Public read block overrides') THEN
        CREATE POLICY "Public read block overrides" ON public.permit_zone_block_overrides FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permit_zone_block_overrides' AND policyname = 'Service role full access block overrides') THEN
        CREATE POLICY "Service role full access block overrides" ON public.permit_zone_block_overrides FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;


-- User reports for incorrect zone hours (with optional photo upload)
CREATE TABLE IF NOT EXISTS public.permit_zone_user_reports (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID,                           -- auth.uid() if logged in
    -- Location
    zone TEXT NOT NULL,
    zone_type TEXT NOT NULL DEFAULT 'residential',
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    address TEXT,
    block_number INTEGER,
    street_direction TEXT DEFAULT '',
    street_name TEXT,
    street_type TEXT DEFAULT '',
    -- What user reported
    reported_schedule TEXT,                  -- user's correction: "Mon-Fri 8am-10pm"
    current_schedule TEXT,                   -- what we showed them (what they're correcting)
    raw_sign_text TEXT,                      -- user typed the sign text
    photo_url TEXT,                          -- Supabase Storage URL
    -- Status
    status TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'applied', 'rejected', 'duplicate'
    admin_notes TEXT,
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pzur_zone ON public.permit_zone_user_reports (zone);
CREATE INDEX IF NOT EXISTS idx_pzur_status ON public.permit_zone_user_reports (status);
CREATE INDEX IF NOT EXISTS idx_pzur_user ON public.permit_zone_user_reports (user_id);

-- RLS
ALTER TABLE public.permit_zone_user_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permit_zone_user_reports' AND policyname = 'Users can read own reports') THEN
        CREATE POLICY "Users can read own reports" ON public.permit_zone_user_reports FOR SELECT USING (auth.uid() = user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permit_zone_user_reports' AND policyname = 'Users can insert reports') THEN
        CREATE POLICY "Users can insert reports" ON public.permit_zone_user_reports FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'permit_zone_user_reports' AND policyname = 'Service role full access user reports') THEN
        CREATE POLICY "Service role full access user reports" ON public.permit_zone_user_reports FOR ALL USING (auth.role() = 'service_role');
    END IF;
END $$;

-- Create storage bucket for sign photos (if it doesn't exist)
-- Note: Supabase Storage buckets are created via the dashboard or API, not SQL.
-- The API endpoint will handle bucket creation.

COMMENT ON TABLE public.permit_zone_block_overrides IS
    'Block-level overrides for permit zone enforcement hours. '
    'Same zone can have different hours on different blocks.';

COMMENT ON TABLE public.permit_zone_user_reports IS
    'User-submitted corrections for permit zone enforcement hours. '
    'Users can report wrong hours and optionally upload a photo of the sign.';
