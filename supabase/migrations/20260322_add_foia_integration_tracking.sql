-- Add FOIA integration tracking to contest_letters
-- Tracks whether CDOT and Finance FOIA data has been received and integrated
-- into the contest letter before mailing.

-- CDOT FOIA: traffic signal data, engineering reports, timing data
ALTER TABLE contest_letters
  ADD COLUMN IF NOT EXISTS cdot_foia_integrated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cdot_foia_integrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS cdot_foia_notes text;

-- Finance FOIA: ticket issuance data, officer logs, payment records
ALTER TABLE contest_letters
  ADD COLUMN IF NOT EXISTS finance_foia_integrated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS finance_foia_integrated_at timestamptz,
  ADD COLUMN IF NOT EXISTS finance_foia_notes text;
