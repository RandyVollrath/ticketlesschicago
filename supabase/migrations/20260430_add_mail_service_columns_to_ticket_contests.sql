-- Add the mail-service columns that pages/api/contest/create-mail-payment.ts
-- and related code paths have been writing to since the feature shipped.
--
-- The columns never existed in the live schema. Every customer who paid the
-- $5 letter-mailing fee has had:
--   * mail_service_payment_intent silently dropped (so the duplicate-payment
--     guard `if (contest.mail_service_payment_intent)` is always false —
--     a customer can be charged multiple times for the same letter),
--   * mailing_address silently dropped (we never persisted where to mail it),
--   * mail_status silently dropped (the cron picks up letters by mail_status
--     so they were never picked up).
--   * extracted_data signature merge was also wiped (separate bug, fixed
--     2026-04-28; smoke test scripts/smoke-test-mail-payment-merge.ts).
--
-- Caught 2026-04-30 by the QA_REPORT.md net #6 smoke test trying to replay
-- the exact UPDATE the production handler does.
--
-- All columns nullable so legacy rows are unaffected.

ALTER TABLE ticket_contests
  ADD COLUMN IF NOT EXISTS mail_service_requested BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS mail_service_payment_intent TEXT,
  ADD COLUMN IF NOT EXISTS mail_service_payment_status TEXT,
  ADD COLUMN IF NOT EXISTS mail_service_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS mail_service_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mailing_address JSONB,
  ADD COLUMN IF NOT EXISTS mail_status TEXT,
  ADD COLUMN IF NOT EXISTS lob_mail_id TEXT,
  ADD COLUMN IF NOT EXISTS mailed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mail_tracking_number TEXT;

-- Speed up the cron query that pulls "ready to mail" rows.
CREATE INDEX IF NOT EXISTS idx_ticket_contests_mail_status
  ON ticket_contests (mail_status)
  WHERE mail_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ticket_contests_mail_service_payment_intent
  ON ticket_contests (mail_service_payment_intent)
  WHERE mail_service_payment_intent IS NOT NULL;

COMMENT ON COLUMN ticket_contests.mail_service_payment_intent IS
  'Stripe PaymentIntent id for the $5 letter-mailing fee. Used as a duplicate-payment guard in pages/api/contest/create-mail-payment.ts.';
COMMENT ON COLUMN ticket_contests.mailing_address IS
  'JSON {name, address, city, state, zip} captured at payment time and used by the Lob mailing cron.';
COMMENT ON COLUMN ticket_contests.mail_status IS
  'Lifecycle: pending → mailed → delivered (or failed). Cron in autopilot-mail-letters reads pending rows.';
