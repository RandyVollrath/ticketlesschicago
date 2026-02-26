-- Street View imagery cache by address
-- Prevents duplicate Google API calls + Claude Vision analysis for the same location.
-- Multiple tickets at the same address share the same cached imagery.

CREATE TABLE IF NOT EXISTS public.street_view_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized address (lowercase, trimmed, "Chicago, IL" suffix stripped)
  address_key TEXT NOT NULL UNIQUE,
  -- Original address string used for the lookup
  original_address TEXT NOT NULL,
  -- Google Street View metadata
  has_imagery BOOLEAN NOT NULL DEFAULT false,
  image_date TEXT, -- e.g. "2024-07"
  panorama_id TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  -- 4 directional image public URLs (Supabase Storage)
  image_urls JSONB DEFAULT '[]'::jsonb,
  -- Claude Vision analysis results
  analyses JSONB DEFAULT '[]'::jsonb,
  analysis_summary TEXT,
  has_signage_issue BOOLEAN DEFAULT false,
  defense_findings JSONB DEFAULT '[]'::jsonb,
  exhibit_urls JSONB DEFAULT '[]'::jsonb,
  -- Timing
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Recheck after 6 months (Google updates Street View periodically)
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '6 months'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by address
CREATE INDEX IF NOT EXISTS idx_street_view_cache_address
  ON public.street_view_cache (address_key);

-- Find expired cache entries for refresh
CREATE INDEX IF NOT EXISTS idx_street_view_cache_expires
  ON public.street_view_cache (expires_at)
  WHERE has_imagery = true;

-- 311 evidence cache by location + date range
-- Stores nearby 311 service requests relevant to a ticket's defense
CREATE TABLE IF NOT EXISTS public.evidence_311_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The ticket this evidence applies to
  ticket_id UUID NOT NULL,
  -- Location searched
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  search_radius_feet INTEGER NOT NULL DEFAULT 500,
  -- Results
  total_requests INTEGER NOT NULL DEFAULT 0,
  defense_relevant_requests JSONB DEFAULT '[]'::jsonb,
  -- Categorized counts
  infrastructure_count INTEGER DEFAULT 0,
  signage_count INTEGER DEFAULT 0,
  construction_count INTEGER DEFAULT 0,
  -- Defense summary for letter generation
  defense_summary TEXT,
  has_defense_evidence BOOLEAN DEFAULT false,
  -- Timing
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evidence_311_ticket
  ON public.evidence_311_cache (ticket_id);

-- Construction permit cache for ticket locations
CREATE TABLE IF NOT EXISTS public.construction_permit_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Location
  address_key TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  -- Active permits near this location
  permits JSONB DEFAULT '[]'::jsonb,
  total_active_permits INTEGER DEFAULT 0,
  -- Defense relevance
  has_sign_blocking_permit BOOLEAN DEFAULT false,
  has_road_work_permit BOOLEAN DEFAULT false,
  defense_summary TEXT,
  -- Timing
  searched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_construction_permit_address
  ON public.construction_permit_cache (address_key);

-- RLS policies (service role only — these are internal caches)
ALTER TABLE public.street_view_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_311_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.construction_permit_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on street_view_cache"
  ON public.street_view_cache FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on evidence_311_cache"
  ON public.evidence_311_cache FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on construction_permit_cache"
  ON public.construction_permit_cache FOR ALL
  USING (auth.role() = 'service_role');
