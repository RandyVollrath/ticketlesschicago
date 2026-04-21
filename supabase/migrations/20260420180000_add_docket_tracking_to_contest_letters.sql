-- Docket + hearing + disposition tracking on contest_letters.
--
-- After a contest letter is mailed, the City of Chicago assigns a docket
-- number and schedules a hearing. Capturing that data lets us:
--   1. Poll AHMS for the city-supplied evidence photos before the hearing
--      (rebuttal prep)
--   2. Track which letters actually won vs lost (outcome analytics for
--      our FOIA-grounded win-rate figures)
--   3. Surface hearing dates + outcomes in the user's dashboard

ALTER TABLE contest_letters
  -- Docket ID assigned by Chicago DOF/DOAH after the contest is opened.
  ADD COLUMN IF NOT EXISTS docket_number TEXT,
  ADD COLUMN IF NOT EXISTS docket_captured_at TIMESTAMPTZ,
  -- "email", "mailed_notice_ocr", "ahms_scrape", "foia_response"
  ADD COLUMN IF NOT EXISTS docket_source TEXT,

  -- Scheduled hearing date (if the contest goes to a live hearing).
  ADD COLUMN IF NOT EXISTS hearing_date DATE,
  -- Most recent AHMS poll timestamp.
  ADD COLUMN IF NOT EXISTS ahms_last_checked_at TIMESTAMPTZ,
  -- Raw AHMS response payload (for debugging + exhibits).
  ADD COLUMN IF NOT EXISTS ahms_payload JSONB,

  -- Final disposition once the hearing concludes or the paper contest is
  -- decided. Canonical values match the Chicago `hearings.disposition`
  -- column in the FOIA dataset: 'Liable', 'Not Liable', 'Dismissed',
  -- 'Denied', etc.
  ADD COLUMN IF NOT EXISTS disposition TEXT,
  ADD COLUMN IF NOT EXISTS disposition_date DATE,
  ADD COLUMN IF NOT EXISTS disposition_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_contest_letters_docket_number
  ON contest_letters(docket_number) WHERE docket_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contest_letters_hearing_date
  ON contest_letters(hearing_date) WHERE hearing_date IS NOT NULL;

COMMENT ON COLUMN contest_letters.docket_number
  IS 'Chicago DOAH/DOF docket assigned after a contest is filed. Required to query AHMS for hearing details + evidence photos.';
COMMENT ON COLUMN contest_letters.disposition
  IS 'Final outcome: Liable, Not Liable, Dismissed, Denied, Continued, etc. Sourced from AHMS or DOAH response mail.';
