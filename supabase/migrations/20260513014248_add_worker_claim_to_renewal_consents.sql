-- Lets a long-running worker script atomically claim a granted consent for
-- processing so concurrent workers (or a stuck retry) don't double-process.
-- Stuck-consent detector cron alerts when claimed_at is older than 1 hour
-- with no consumed_at set.

ALTER TABLE renewal_purchase_consents
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS claimed_by TEXT;

CREATE INDEX IF NOT EXISTS idx_renewal_consents_unclaimed_granted
  ON renewal_purchase_consents (granted_at)
  WHERE status = 'granted' AND claimed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_renewal_consents_stuck_claimed
  ON renewal_purchase_consents (claimed_at)
  WHERE claimed_at IS NOT NULL AND consumed_at IS NULL;

COMMENT ON COLUMN renewal_purchase_consents.claimed_at IS
  'Set when a worker script begins processing this consent. Atomic with claimed_by.';
COMMENT ON COLUMN renewal_purchase_consents.claimed_by IS
  'Worker identifier (hostname or arbitrary tag) that owns this row currently.';
