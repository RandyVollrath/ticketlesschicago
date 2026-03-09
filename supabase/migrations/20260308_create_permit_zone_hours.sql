-- Permit Zone Hours — add Street View pipeline columns
-- Table already exists with columns: id, zone, zone_type, restriction_hours,
-- restriction_days, restriction_schedule, source, reported_by, reported_address,
-- confidence, notes, created_at, updated_at
--
-- This migration adds columns needed by scripts/collect-permit-zone-hours.ts

-- Add Street View evidence columns (idempotent)
ALTER TABLE public.permit_zone_hours
  ADD COLUMN IF NOT EXISTS raw_sign_text TEXT,
  ADD COLUMN IF NOT EXISTS street_view_url TEXT,
  ADD COLUMN IF NOT EXISTS sample_address TEXT,
  ADD COLUMN IF NOT EXISTS image_urls JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS extracted_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Create unique constraint if not exists (for upserts)
-- Note: IF NOT EXISTS not supported for constraints in all PG versions,
-- so we use a DO block
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'permit_zone_hours_zone_zone_type_key'
  ) THEN
    ALTER TABLE public.permit_zone_hours
      ADD CONSTRAINT permit_zone_hours_zone_zone_type_key UNIQUE (zone, zone_type);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_permit_zone_hours_confidence
  ON public.permit_zone_hours (confidence);

CREATE INDEX IF NOT EXISTS idx_permit_zone_hours_zone
  ON public.permit_zone_hours (zone, zone_type);

-- RLS (idempotent)
ALTER TABLE public.permit_zone_hours ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'permit_zone_hours' AND policyname = 'Service role full access on permit_zone_hours'
  ) THEN
    CREATE POLICY "Service role full access on permit_zone_hours"
      ON public.permit_zone_hours FOR ALL
      USING (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.permit_zone_hours IS
  'Verified permit zone enforcement schedules. Populated via Street View + Claude Vision pipeline and user reports. '
  'Only rows with confidence=confirmed are used in production parking notifications.';
