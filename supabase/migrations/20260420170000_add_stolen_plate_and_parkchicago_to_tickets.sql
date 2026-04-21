-- Phase 4 of the scraper / defense upgrade: persist stolen-plate and
-- ParkChicago-receipt evidence onto detected_tickets. Both defenses are
-- top winning reasons per City of Chicago hearing records:
--   - "Plate or Vehicle was Stolen and Not Recovered" is the #1 reason
--     red-light / speed-camera tickets get dismissed (6,293 / 3,069 /
--     2,037 wins in the FOIA hearings dataset).
--   - "Violation is Factually Inconsistent" paired with a valid
--     ParkChicago receipt is the dominant dismissal path for expired-
--     meter tickets (~67% mail win rate).
--
-- All columns nullable so legacy rows keep working.

ALTER TABLE detected_tickets
  -- Stolen-plate defense fields (§ 9-102-050(c) for camera violations)
  ADD COLUMN IF NOT EXISTS plate_stolen BOOLEAN,
  ADD COLUMN IF NOT EXISTS plate_stolen_report_number TEXT,
  ADD COLUMN IF NOT EXISTS plate_stolen_report_agency TEXT,
  ADD COLUMN IF NOT EXISTS plate_stolen_report_date DATE,
  ADD COLUMN IF NOT EXISTS plate_stolen_incident_date DATE,

  -- ParkChicago receipt fields (expired-meter defense)
  ADD COLUMN IF NOT EXISTS parkchicago_zone TEXT,
  ADD COLUMN IF NOT EXISTS parkchicago_start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parkchicago_end_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS parkchicago_amount_paid NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS parkchicago_transaction_id TEXT;

COMMENT ON COLUMN detected_tickets.plate_stolen
  IS 'User confirmed (via evidence email or OCR of police report) that the plate was stolen/lost/used without permission around the violation date.';
COMMENT ON COLUMN detected_tickets.plate_stolen_report_number
  IS 'Chicago Police RD number or other jurisdiction case number, extracted from user-uploaded report.';
COMMENT ON COLUMN detected_tickets.parkchicago_transaction_id
  IS 'ParkChicago confirmation/transaction ID from user-uploaded receipt.';
