CREATE TABLE IF NOT EXISTS autopay_consent_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contest_letter_id UUID REFERENCES contest_letters(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  ip_address TEXT,
  user_agent TEXT,
  page_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS autopay_consent_events_user_idx ON autopay_consent_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS autopay_consent_events_letter_idx ON autopay_consent_events(contest_letter_id, created_at DESC);

ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS autopay_pre_charge_notified_at TIMESTAMPTZ;
