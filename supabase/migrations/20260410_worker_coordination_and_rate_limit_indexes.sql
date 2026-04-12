-- ============================================================================
-- SCALING: Worker coordination columns + rate_limits index
-- April 10, 2026
--
-- 1. Adds worker_id + worker_claimed_at to monitored_plates so multiple
--    machines can claim and process plates without stepping on each other.
--
-- 2. Adds a compound index on rate_limits(identifier, action, created_at)
--    to speed up the rate limit check query that runs on every auth/checkout.
-- ============================================================================

-- Worker coordination columns for distributed scraping
ALTER TABLE monitored_plates
  ADD COLUMN IF NOT EXISTS worker_id TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS worker_claimed_at TIMESTAMPTZ DEFAULT NULL;

-- Index for finding unclaimed plates quickly
CREATE INDEX IF NOT EXISTS idx_monitored_plates_worker_status
ON monitored_plates(status, worker_id)
WHERE status = 'active';

-- Index for releasing stale worker locks
CREATE INDEX IF NOT EXISTS idx_monitored_plates_worker_claimed
ON monitored_plates(worker_claimed_at)
WHERE worker_id IS NOT NULL;

-- Rate limits: the check query filters on (identifier, action, created_at)
-- Without this index, every auth attempt does a full table scan
CREATE INDEX IF NOT EXISTS idx_rate_limits_identifier_action_created
ON rate_limits(identifier, action, created_at DESC);
