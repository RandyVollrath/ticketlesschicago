-- Expand the detected_tickets.status CHECK constraint to include terminal
-- contest outcomes ('won', 'lost', 'reduced', 'hearing_scheduled',
-- 'contested_online') and the missing pre-outcome states the code already
-- writes ('paid', 'cancelled').
--
-- Why this matters: lib/contest-outcome-tracker.ts has been writing
-- status='won' / 'lost' / 'reduced' since the contest pipeline shipped,
-- but the original CHECK constraint only allowed the pre-outcome lifecycle
-- states. Every dismissal on the live site silently failed to flip the
-- ticket status — the row stayed in 'mailed' forever, and the customer's
-- ticket history showed it as still pending.
--
-- The bug was caught by the synthetic contest-pipeline smoke test
-- (scripts/smoke-test-contest-pipeline.ts) which inserts a fake "Not
-- Liable" portal result and asserts the ticket flips to 'won'. The DB
-- check rejected 'won' even though the code path is the right one.
--
-- This migration expands the allowed set without removing any existing
-- value, so no rows are invalidated.

ALTER TABLE detected_tickets
  DROP CONSTRAINT IF EXISTS detected_tickets_status_check;

ALTER TABLE detected_tickets
  ADD CONSTRAINT detected_tickets_status_check CHECK (
    status IN (
      -- Pre-outcome lifecycle (existing)
      'pending_evidence',
      'needs_approval',
      'found',
      'letter_generated',
      'approved',
      'mailed',
      'evidence_received',
      'skipped',
      -- In-flight outcome states
      'hearing_scheduled',
      'contested_online',
      -- Terminal outcome states (the ones the contest tracker actually writes)
      'won',
      'lost',
      'reduced',
      -- Misc terminal states the code paths reference
      'paid',
      'cancelled'
    )
  );
