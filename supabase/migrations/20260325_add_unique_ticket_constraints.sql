-- Add unique constraints on ticket_number for detected_tickets and portal_check_results
-- to prevent duplicate inserts from concurrent cron runs.
--
-- Step 1: Remove existing duplicates (keep the most recent row per ticket_number)
-- Step 2: Add unique index (using CREATE UNIQUE INDEX IF NOT EXISTS for idempotency)

-- ============================================================
-- detected_tickets: deduplicate then add unique constraint
-- ============================================================

-- Delete duplicate rows, keeping the one with the latest updated_at (or created_at)
DELETE FROM detected_tickets
WHERE id NOT IN (
  SELECT DISTINCT ON (ticket_number) id
  FROM detected_tickets
  WHERE ticket_number IS NOT NULL
  ORDER BY ticket_number, updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id
)
AND ticket_number IS NOT NULL
AND ticket_number IN (
  SELECT ticket_number
  FROM detected_tickets
  WHERE ticket_number IS NOT NULL
  GROUP BY ticket_number
  HAVING COUNT(*) > 1
);

-- Add unique index (partial — only on non-null ticket_numbers)
CREATE UNIQUE INDEX IF NOT EXISTS idx_detected_tickets_ticket_number_unique
  ON detected_tickets (ticket_number)
  WHERE ticket_number IS NOT NULL;

-- ============================================================
-- portal_check_results: deduplicate then add unique constraint
-- ============================================================

-- Delete duplicate rows, keeping the most recent
DELETE FROM portal_check_results
WHERE id NOT IN (
  SELECT DISTINCT ON (ticket_number) id
  FROM portal_check_results
  WHERE ticket_number IS NOT NULL
  ORDER BY ticket_number, checked_at DESC NULLS LAST, created_at DESC NULLS LAST, id
)
AND ticket_number IS NOT NULL
AND ticket_number IN (
  SELECT ticket_number
  FROM portal_check_results
  WHERE ticket_number IS NOT NULL
  GROUP BY ticket_number
  HAVING COUNT(*) > 1
);

-- Add unique index (partial — only on non-null ticket_numbers)
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_check_results_ticket_number_unique
  ON portal_check_results (ticket_number)
  WHERE ticket_number IS NOT NULL;
