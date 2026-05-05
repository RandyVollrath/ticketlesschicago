-- Autopay consent audit log + pre-charge notification tracking
--
-- Two purposes:
--   1. Capture every toggle/mode/cap change with IP + user-agent so we have
--      a defensible audit trail for chargebacks and disputes. The toggle
--      on /account/autopay IS the legal consent; this table records it.
--   2. Track when we've sent the user the "we're about to charge you" email
--      so we wait 24h before actually charging. Gives users a real chance
--      to opt out before money moves.

CREATE TABLE IF NOT EXISTS autopay_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contest_letter_id UUID REFERENCES contest_letters(id) ON DELETE CASCADE,

  -- 'opt_in' | 'opt_out' | 'mode_change' | 'cap_change'
  event_type TEXT NOT NULL,

  previous_state JSONB,  -- snapshot of opt_in/mode/cap before
  new_state JSONB,       -- snapshot after

  ip_address TEXT,       -- captured server-side from req headers
  user_agent TEXT,       -- captured from req headers
  page_url TEXT,         -- usually /account/autopay

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS autopay_consent_events_user_idx
  ON autopay_consent_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autopay_consent_events_letter_idx
  ON autopay_consent_events(contest_letter_id, created_at DESC);

-- Track when we sent the user "we're about to charge you" email.
-- The autopay executor will not charge until this is at least 24h old.
ALTER TABLE contest_letters
  ADD COLUMN IF NOT EXISTS autopay_pre_charge_notified_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS contest_letters_autopay_pending_idx
  ON contest_letters(autopay_pre_charge_notified_at)
  WHERE autopay_opt_in = true AND lifecycle_status IN ('lost', 'reduced') AND paid_at IS NULL;
