-- Tag the residential permit-zone enforcement-hours dataset with its real
-- provenance. The current rows were gathered by reading posted parking signs
-- in Google Street View (manually plus an AI-extraction pipeline). Coverage
-- is uneven and per-block accuracy is poor, so we no longer surface the
-- specific hours to end users — but we keep the rows around for the admin
-- correction workflow, and we want the audit trail to be honest about where
-- the data came from.
--
-- Strategy: backfill `source = 'street_view'` on any row whose source is
-- missing or vague ('unknown', NULL). Do NOT overwrite rows that already
-- have a specific provenance like 'user_report', 'admin_approved',
-- 'ai_extracted', or 'foia' — those are legitimate alternate sources and
-- their attribution must be preserved.

UPDATE public.permit_zone_hours
SET source = 'street_view',
    updated_at = now()
WHERE source IS NULL
   OR source = ''
   OR lower(source) = 'unknown';

-- Same treatment for block-level overrides, which were seeded from the same
-- Street View pipeline before the user-reporting flow existed.
UPDATE public.permit_zone_block_overrides
SET source = 'street_view',
    updated_at = now()
WHERE source IS NULL
   OR source = ''
   OR lower(source) = 'unknown';

COMMENT ON COLUMN public.permit_zone_hours.source IS
  'Provenance of the enforcement schedule. Common values: '
  'street_view (read off posted signs in Google Street View — bulk of the '
  'dataset, accuracy is uneven so hours are no longer surfaced to end '
  'users), ai_extracted (Gemini/Claude vision on Street View imagery), '
  'user_report (in-app correction by a user), admin_approved (reviewed in '
  '/admin/permit-zone-corrections), foia (FOIA ticket data).';
