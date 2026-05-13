-- Add drip-campaign tracking columns to foia_history_requests.
--
-- Flyer/QR users submit a FOIA but don't create a user_profile, so they
-- can't join drip_campaign_status (which requires user_id). Instead we
-- track their drip state directly on the FOIA row.
--
-- Sequence (handled by /api/cron/foia-history-drip):
--   day 3 — educational email about Chicago ticket math
--   day 7 — soft pitch for Autopilot
-- The original confirmation + filed + results emails are sent by the
-- existing pipeline and are NOT part of this drip.

ALTER TABLE public.foia_history_requests
  ADD COLUMN IF NOT EXISTS drip_day3_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drip_day7_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS drip_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS drip_unsubscribed_at TIMESTAMPTZ;

-- Composite index makes the cron's "what's due" query fast even at scale.
CREATE INDEX IF NOT EXISTS foia_history_requests_drip_due_idx
  ON public.foia_history_requests (created_at, drip_unsubscribed)
  WHERE drip_unsubscribed = FALSE;
