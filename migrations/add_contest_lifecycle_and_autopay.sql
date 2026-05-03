ALTER TABLE public.contest_letters
  ADD COLUMN IF NOT EXISTS submission_channel TEXT,
  ADD COLUMN IF NOT EXISTS submission_state TEXT,
  ADD COLUMN IF NOT EXISTS submission_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submission_confirmation_id TEXT,
  ADD COLUMN IF NOT EXISTS submission_receipt_source TEXT,
  ADD COLUMN IF NOT EXISTS submission_receipt_payload JSONB,
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT,
  ADD COLUMN IF NOT EXISTS lifecycle_status_changed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_status_source TEXT,
  ADD COLUMN IF NOT EXISTS last_status_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS city_case_status_raw TEXT,
  ADD COLUMN IF NOT EXISTS city_case_payload JSONB,
  ADD COLUMN IF NOT EXISTS contest_outcome TEXT,
  ADD COLUMN IF NOT EXISTS contest_outcome_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS autopay_opt_in BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS autopay_mode TEXT,
  ADD COLUMN IF NOT EXISTS autopay_cap_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS autopay_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autopay_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS autopay_status TEXT,
  ADD COLUMN IF NOT EXISTS autopay_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS autopay_result_payload JSONB,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reference TEXT,
  ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS payment_source TEXT;

UPDATE public.contest_letters
SET lifecycle_status = CASE
  WHEN lifecycle_status IS NOT NULL THEN lifecycle_status
  WHEN status IN ('won', 'lost', 'reduced') THEN status
  WHEN status = 'hearing_scheduled' THEN 'hearing_scheduled'
  WHEN status = 'sent' AND COALESCE(econtest_status, '') = 'submitted' THEN 'submission_confirmed'
  WHEN status = 'sent' THEN 'submitted'
  WHEN status IN ('approved', 'ready') THEN 'approved'
  ELSE 'draft'
END,
    lifecycle_status_changed_at = COALESCE(lifecycle_status_changed_at, updated_at, created_at, now()),
    submission_channel = COALESCE(submission_channel, CASE WHEN econtest_status IS NOT NULL THEN 'econtest' WHEN lob_letter_id IS NOT NULL THEN 'mail' ELSE NULL END),
    submission_state = COALESCE(submission_state, CASE WHEN econtest_status = 'submitted' THEN 'confirmed' WHEN econtest_status IS NOT NULL THEN econtest_status WHEN status = 'sent' THEN 'submitted' ELSE NULL END),
    submission_confirmed_at = COALESCE(submission_confirmed_at, econtest_submitted_at, sent_at),
    submission_confirmation_id = COALESCE(submission_confirmation_id, econtest_confirmation_id),
    last_status_source = COALESCE(last_status_source, CASE WHEN disposition IS NOT NULL THEN 'portal' WHEN ahms_payload IS NOT NULL THEN 'ahms' WHEN econtest_response IS NOT NULL THEN 'econtest' ELSE NULL END),
    last_status_check_at = COALESCE(last_status_check_at, ahms_last_checked_at, econtest_submitted_at, sent_at),
    city_case_status_raw = COALESCE(city_case_status_raw, disposition),
    final_amount = COALESCE(final_amount, charge_amount);

CREATE TABLE IF NOT EXISTS public.contest_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_letter_id UUID NOT NULL REFERENCES public.contest_letters(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL REFERENCES public.detected_tickets(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  normalized_status TEXT,
  raw_status TEXT,
  details JSONB
);

ALTER TABLE public.contest_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own contest status events" ON public.contest_status_events;
CREATE POLICY "Users can view own contest status events"
  ON public.contest_status_events
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_contest_status_events_letter_id
  ON public.contest_status_events(contest_letter_id);

CREATE INDEX IF NOT EXISTS idx_contest_status_events_ticket_id
  ON public.contest_status_events(ticket_id);

CREATE INDEX IF NOT EXISTS idx_contest_status_events_observed_at_desc
  ON public.contest_status_events(observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_contest_letters_lifecycle_status
  ON public.contest_letters(lifecycle_status);

CREATE INDEX IF NOT EXISTS idx_contest_letters_autopay_status
  ON public.contest_letters(autopay_status);

CREATE INDEX IF NOT EXISTS idx_contest_letters_last_status_check_at
  ON public.contest_letters(last_status_check_at);
