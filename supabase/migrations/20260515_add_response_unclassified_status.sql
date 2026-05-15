-- Add 'response_unclassified' status to both FOIA tables.
--
-- Background: the previous evidence-FOIA classifier on ticket 9205513400
-- flipped to fulfilled_with_records (0 documents) after the city's second
-- GovQA boilerplate acknowledgment landed 10 seconds after an extension
-- notice. The bare "we received your request and are processing it" email
-- contains the substring "attached" inside GovQA's standard footer link,
-- which the old heuristic treated as a fulfillment cue.
--
-- The new classifier (lib/contest-outcome-tracker.ts) refuses to close a
-- FOIA on ambiguous evidence. When the email is neither a clear fulfillment
-- (real attachments or specific fulfillment phrasing) nor a clear denial
-- ("no responsive records" etc), the request is parked in
-- 'response_unclassified' and the admin is paged for manual review.

ALTER TABLE public.ticket_foia_requests
  DROP CONSTRAINT IF EXISTS ticket_foia_requests_status_check;

ALTER TABLE public.ticket_foia_requests
  ADD CONSTRAINT ticket_foia_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent', 'extension_requested', 'overdue',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records',
    'failed', 'not_needed', 'response_unclassified'
  ));

ALTER TABLE public.foia_history_requests
  DROP CONSTRAINT IF EXISTS foia_history_requests_status_check;

ALTER TABLE public.foia_history_requests
  ADD CONSTRAINT foia_history_requests_status_check
  CHECK (status IN (
    'queued', 'drafting', 'sent', 'extension_requested', 'overdue',
    'fulfilled', 'fulfilled_with_records', 'fulfilled_denial', 'no_records',
    'failed', 'cancelled', 'response_unclassified'
  ));
