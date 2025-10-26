-- Add all missing columns to court_case_outcomes table
-- Run this in Supabase SQL Editor

ALTER TABLE court_case_outcomes
  ADD COLUMN IF NOT EXISTS case_number TEXT,
  ADD COLUMN IF NOT EXISTS ticket_number TEXT,
  ADD COLUMN IF NOT EXISTS violation_description TEXT,
  ADD COLUMN IF NOT EXISTS ticket_location TEXT,
  ADD COLUMN IF NOT EXISTS ward TEXT,
  ADD COLUMN IF NOT EXISTS court_location TEXT,
  ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS final_amount DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS reduction_percentage DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS contest_grounds TEXT[],
  ADD COLUMN IF NOT EXISTS defense_strategy TEXT,
  ADD COLUMN IF NOT EXISTS evidence_submitted JSONB,
  ADD COLUMN IF NOT EXISTS attorney_represented BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ticket_date DATE,
  ADD COLUMN IF NOT EXISTS contest_filed_date DATE,
  ADD COLUMN IF NOT EXISTS hearing_date DATE,
  ADD COLUMN IF NOT EXISTS decision_date DATE,
  ADD COLUMN IF NOT EXISTS days_to_decision INTEGER,
  ADD COLUMN IF NOT EXISTS judge_name TEXT,
  ADD COLUMN IF NOT EXISTS hearing_officer_name TEXT,
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS scrape_date TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT now();

-- Add outcome constraint if it doesn't exist
DO $$
BEGIN
  ALTER TABLE court_case_outcomes
    DROP CONSTRAINT IF EXISTS court_case_outcomes_outcome_check;

  ALTER TABLE court_case_outcomes
    ADD CONSTRAINT court_case_outcomes_outcome_check
    CHECK (outcome IN ('dismissed', 'reduced', 'upheld', 'withdrawn', 'pending'));
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS court_outcomes_violation_code_idx ON court_case_outcomes(violation_code);
CREATE INDEX IF NOT EXISTS court_outcomes_outcome_idx ON court_case_outcomes(outcome);
CREATE INDEX IF NOT EXISTS court_outcomes_ward_idx ON court_case_outcomes(ward);
CREATE INDEX IF NOT EXISTS court_outcomes_judge_idx ON court_case_outcomes(judge_name);
CREATE INDEX IF NOT EXISTS court_outcomes_ticket_date_idx ON court_case_outcomes(ticket_date);
CREATE INDEX IF NOT EXISTS court_outcomes_decision_date_idx ON court_case_outcomes(decision_date);

-- Create update trigger
DROP TRIGGER IF EXISTS update_court_outcomes_updated_at ON court_case_outcomes;
CREATE TRIGGER update_court_outcomes_updated_at
  BEFORE UPDATE ON court_case_outcomes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Success
SELECT 'court_case_outcomes columns added!' as status,
       COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name = 'court_case_outcomes';
