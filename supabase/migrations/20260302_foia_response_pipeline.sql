-- Expand FOIA request status values to distinguish response outcomes.
-- Old statuses: queued, drafting, sent, fulfilled, failed, not_needed
-- New statuses add: fulfilled_with_records, fulfilled_denial
-- This lets the letter generator and admin panel distinguish between:
--   - City sent actual documents (fulfilled_with_records)
--   - City said "no responsive records" (fulfilled_denial)
--   - Legacy "fulfilled" still accepted for backward compat

-- Drop the old CHECK constraint and add a new one with expanded values
ALTER TABLE public.ticket_foia_requests
  DROP CONSTRAINT IF EXISTS ticket_foia_requests_status_check;

ALTER TABLE public.ticket_foia_requests
  ADD CONSTRAINT ticket_foia_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial',
    'failed', 'not_needed'
  ));

-- Add a column to flag tickets that need letter re-generation after FOIA response
-- This is checked by autopilot-generate-letters cron
ALTER TABLE public.contest_letters
  ADD COLUMN IF NOT EXISTS needs_regeneration boolean NOT NULL DEFAULT false;

ALTER TABLE public.contest_letters
  ADD COLUMN IF NOT EXISTS regeneration_reason text NULL;
