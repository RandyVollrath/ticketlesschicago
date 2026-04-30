-- property_tax_appeals.refunded_at
--
-- The Stripe webhook charge.refunded handler (pages/api/stripe-webhook.ts)
-- has been writing/reading this column since the property tax appeal
-- product shipped, but the column was never created. Refunds were silently
-- partial: status='refunded' wrote, but refunded_at and the idempotency
-- check both no-oped (Supabase returned SelectQueryError, swallowed by the
-- destructure of `data`).
--
-- Caught 2026-04-30 while ratcheting stripe-webhook.ts TS errors against
-- the regenerated database.types.ts.

ALTER TABLE property_tax_appeals
  ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_property_tax_appeals_refunded_at
  ON property_tax_appeals (refunded_at)
  WHERE refunded_at IS NOT NULL;

COMMENT ON COLUMN property_tax_appeals.refunded_at IS
  'Set by stripe-webhook charge.refunded handler. Used for refund-idempotency check on retry deliveries.';
