-- Add 'overdue' status to both FOIA tables
-- The monitor-foia-deadlines cron marks FOIAs as 'overdue' when they exceed
-- the Illinois FOIA response deadline (5 business days, or 10 with extension).
-- This status was missing from the check constraints, causing silent update failures.

-- ticket_foia_requests
ALTER TABLE public.ticket_foia_requests
  DROP CONSTRAINT IF EXISTS ticket_foia_requests_status_check;

ALTER TABLE public.ticket_foia_requests
  ADD CONSTRAINT ticket_foia_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent', 'extension_requested', 'overdue',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records',
    'failed', 'not_needed'
  ));

-- foia_history_requests
ALTER TABLE public.foia_history_requests
  DROP CONSTRAINT IF EXISTS foia_history_requests_status_check;

ALTER TABLE public.foia_history_requests
  ADD CONSTRAINT foia_history_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent', 'extension_requested', 'overdue',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records',
    'failed', 'cancelled'
  ));
