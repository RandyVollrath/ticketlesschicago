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
  -- No expiration — street-level signage rarely changes and imagery is expensive to re-fetch
  expires_at TIMESTAMPTZ, -- NULL = never expires
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup by address
CREATE INDEX IF NOT EXISTS idx_street_view_cache_address
  ON public.street_view_cache (address_key);

-- Find entries by imagery status (for potential manual refresh)
CREATE INDEX IF NOT EXISTS idx_street_view_cache_has_imagery
  ON public.street_view_cache (has_imagery)
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

-- ============================================
-- MEDIUM PRIORITY: Portal check results (Task 6)
-- Stores raw portal scraper results for outcome tracking
-- ============================================

CREATE TABLE IF NOT EXISTS public.portal_check_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT NOT NULL,
  plate TEXT,
  state TEXT DEFAULT 'IL',
  -- Portal data
  ticket_queue TEXT,
  hearing_disposition TEXT,
  current_amount_due DECIMAL(10,2),
  original_amount DECIMAL(10,2),
  violation_code TEXT,
  violation_description TEXT,
  issue_date DATE,
  -- Raw response
  raw_response JSONB,
  -- Timing
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portal_check_ticket
  ON public.portal_check_results (ticket_number, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_portal_check_plate
  ON public.portal_check_results (plate, state);

-- ============================================
-- MEDIUM PRIORITY: Ticket location patterns (Task 8)
-- Hotspot detection for letter generation
-- ============================================

CREATE TABLE IF NOT EXISTS public.ticket_location_patterns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  normalized_address TEXT NOT NULL UNIQUE,
  address TEXT NOT NULL,
  ticket_count INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  violation_types TEXT[] DEFAULT '{}',
  officers TEXT[] DEFAULT '{}',
  total_amount DECIMAL(10,2) DEFAULT 0,
  dismissal_rate DECIMAL(5,2),
  is_hotspot BOOLEAN DEFAULT false,
  defense_recommendation TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_patterns_hotspot
  ON public.ticket_location_patterns (is_hotspot)
  WHERE is_hotspot = true;

CREATE INDEX IF NOT EXISTS idx_location_patterns_address
  ON public.ticket_location_patterns (normalized_address);

-- ============================================
-- MEDIUM PRIORITY: User compliance documents (Task 10)
-- Auto-classified receipts and compliance documents
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_compliance_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  doc_type TEXT NOT NULL CHECK (doc_type IN ('city_sticker', 'registration', 'insurance', 'parking_receipt', 'other')),
  -- Source info
  source_email TEXT,
  source_subject TEXT,
  filename TEXT,
  -- Classification
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  classification_reason TEXT,
  -- Metadata
  metadata JSONB DEFAULT '{}',
  -- Timing
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_compliance_docs_user
  ON public.user_compliance_docs (user_id);

CREATE INDEX IF NOT EXISTS idx_compliance_docs_type
  ON public.user_compliance_docs (doc_type);

-- RLS policies for new tables
ALTER TABLE public.portal_check_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_location_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_compliance_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on portal_check_results"
  ON public.portal_check_results FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on ticket_location_patterns"
  ON public.ticket_location_patterns FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role full access on user_compliance_docs"
  ON public.user_compliance_docs FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Users read own compliance docs"
  ON public.user_compliance_docs FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================
-- Add columns to detected_tickets for outcome tracking
-- ============================================

ALTER TABLE public.detected_tickets
  ADD COLUMN IF NOT EXISTS last_portal_status TEXT,
  ADD COLUMN IF NOT EXISTS last_portal_check TIMESTAMPTZ;
