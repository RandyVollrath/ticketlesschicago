-- Add extension_requested status to both FOIA tables
-- City of Chicago FOIA officers (like Frank Davis) can request 5 business day
-- extensions under 5 ILCS 140 Section 3(e). We need to track this status.

-- Also adds 'drafting' to foia_history_requests (was missing — the cron already
-- uses it via `as any` cast but the constraint blocked it).

-- ticket_foia_requests: add extension_requested and no_records
ALTER TABLE public.ticket_foia_requests
  DROP CONSTRAINT IF EXISTS ticket_foia_requests_status_check;

ALTER TABLE public.ticket_foia_requests
  ADD CONSTRAINT ticket_foia_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent', 'extension_requested',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records',
    'failed', 'not_needed'
  ));

-- foia_history_requests: add drafting, extension_requested, fulfilled_with_records, fulfilled_denial, no_records
ALTER TABLE public.foia_history_requests
  DROP CONSTRAINT IF EXISTS foia_history_requests_status_check;

ALTER TABLE public.foia_history_requests
  ADD CONSTRAINT foia_history_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent', 'extension_requested',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records',
    'failed', 'cancelled'
  ));
