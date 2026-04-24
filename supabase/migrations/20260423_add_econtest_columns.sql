-- Add eContest portal submission tracking columns to contest_letters
-- These track electronic submissions via parkingtickets.chicago.gov/EHearingWeb/
-- Lob mailing remains the fallback if eContest fails.

ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS econtest_status TEXT;
ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS econtest_submitted_at TIMESTAMPTZ;
ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS econtest_confirmation_id TEXT;
ALTER TABLE contest_letters ADD COLUMN IF NOT EXISTS econtest_response JSONB;

-- Index for the submission script query (find approved letters not yet attempted)
CREATE INDEX IF NOT EXISTS idx_contest_letters_econtest_pending
  ON contest_letters (status, econtest_status)
  WHERE econtest_status IS NULL AND lob_letter_id IS NULL;

COMMENT ON COLUMN contest_letters.econtest_status IS 'eContest portal status: null=not attempted, submitted=success, failed=fallback to Lob, ineligible=ticket not contestable online';
COMMENT ON COLUMN contest_letters.econtest_submitted_at IS 'When the contest was submitted via eContest portal';
COMMENT ON COLUMN contest_letters.econtest_confirmation_id IS 'Confirmation/reference number from eContest portal';
COMMENT ON COLUMN contest_letters.econtest_response IS 'Full response payload from eContest submission attempt';
