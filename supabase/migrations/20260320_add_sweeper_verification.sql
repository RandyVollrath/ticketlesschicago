-- Add sweeper_verification column to preserve SweepTracker GPS evidence
-- The city's API only retains ~7-30 days of history, so we must capture
-- this data immediately when a street cleaning ticket is detected.
ALTER TABLE detected_tickets
  ADD COLUMN IF NOT EXISTS sweeper_verification JSONB DEFAULT NULL;

COMMENT ON COLUMN detected_tickets.sweeper_verification IS
  'City of Chicago SweepTracker GPS verification data — preserved at ticket detection time before the rolling history window expires';
