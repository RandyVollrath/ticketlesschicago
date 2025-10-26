-- STEP 1: Create court_case_outcomes table
-- Copy and run this FIRST, check for errors before continuing

CREATE TABLE IF NOT EXISTS court_case_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  case_number TEXT,
  ticket_number TEXT,
  violation_code TEXT NOT NULL,
  violation_description TEXT,
  ticket_amount DECIMAL(10, 2),
  ticket_location TEXT,
  ward TEXT,
  court_location TEXT,
  outcome TEXT CHECK (outcome IN ('dismissed', 'reduced', 'upheld', 'withdrawn', 'pending')),
  original_amount DECIMAL(10, 2),
  final_amount DECIMAL(10, 2),
  reduction_percentage DECIMAL(5, 2),
  contest_grounds TEXT[],
  defense_strategy TEXT,
  evidence_submitted JSONB,
  attorney_represented BOOLEAN DEFAULT false,
  ticket_date DATE,
  contest_filed_date DATE,
  hearing_date DATE,
  decision_date DATE,
  days_to_decision INTEGER,
  judge_name TEXT,
  hearing_officer_name TEXT,
  data_source TEXT,
  scrape_date TIMESTAMP WITH TIME ZONE,
  verified BOOLEAN DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Success? Continue to next query
SELECT 'court_case_outcomes table created!' as status;
