-- City Payment Queue
--
-- When the autopay executor charges a user's card via Stripe in 'live' mode,
-- it inserts a row here. A separate Playwright-based script (running on a
-- local machine / VPS via systemd timer, NOT on Vercel) picks rows up,
-- pays the City of Chicago payment portal, and updates the corresponding
-- contest_letter to lifecycle_status='paid'.
--
-- The queue is also the audit trail for what's been attempted, succeeded,
-- and failed — so we can refund Stripe charges that the city leg never
-- completed.

CREATE TABLE IF NOT EXISTS city_payment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What we are paying for
  contest_letter_id UUID NOT NULL REFERENCES contest_letters(id) ON DELETE CASCADE,
  ticket_id UUID NOT NULL,
  user_id UUID NOT NULL,

  -- City portal lookup
  ticket_number TEXT NOT NULL,
  plate TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'IL',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),

  -- Stripe charge that funds this payment
  stripe_payment_intent_id TEXT NOT NULL,

  -- Worker bookkeeping
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'paid', 'failed', 'refunded', 'manual_required')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_error TEXT,
  worker_id TEXT,
  worker_claimed_at TIMESTAMPTZ,

  -- Outcome
  city_payment_reference TEXT,         -- City confirmation number
  city_response_payload JSONB,         -- Raw portal response for audit
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  refund_reason TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One queue entry per Stripe charge — prevents the executor from
  -- queueing the same letter twice.
  CONSTRAINT city_payment_queue_pi_unique UNIQUE (stripe_payment_intent_id)
);

CREATE INDEX IF NOT EXISTS city_payment_queue_status_idx
  ON city_payment_queue(status, created_at)
  WHERE status IN ('pending', 'in_progress');

CREATE INDEX IF NOT EXISTS city_payment_queue_letter_idx
  ON city_payment_queue(contest_letter_id);
