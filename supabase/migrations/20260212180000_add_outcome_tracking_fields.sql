-- Add outcome tracking fields to detected_tickets
ALTER TABLE detected_tickets
  ADD COLUMN IF NOT EXISTS contest_outcome text,           -- 'dismissed', 'not_liable', 'liable', 'paid', 'unknown'
  ADD COLUMN IF NOT EXISTS contest_outcome_date timestamptz,
  ADD COLUMN IF NOT EXISTS contest_outcome_source text,    -- 'portal_check', 'user_reported', 'data_portal'
  ADD COLUMN IF NOT EXISTS hearing_disposition text,       -- Raw from portal: 'Not Liable', 'Liable', 'Dismissed'
  ADD COLUMN IF NOT EXISTS last_outcome_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS outcome_check_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS street_view_url text,           -- Google Street View static image URL
  ADD COLUMN IF NOT EXISTS street_view_date text;          -- Date of the Street View imagery

-- Index for the outcome check cron to find tickets needing checks
CREATE INDEX IF NOT EXISTS idx_detected_tickets_outcome_check
  ON detected_tickets (status, contest_outcome, last_outcome_check_at)
  WHERE status = 'mailed' AND contest_outcome IS NULL;
