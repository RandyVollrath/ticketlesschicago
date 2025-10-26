-- Test: Create ONE table to make sure SQL execution works
-- Run this in Supabase SQL Editor

DROP TABLE IF EXISTS court_case_outcomes CASCADE;

CREATE TABLE court_case_outcomes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  violation_code TEXT NOT NULL,
  ticket_amount DECIMAL(10, 2),
  outcome TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE court_case_outcomes ENABLE ROW LEVEL SECURITY;

-- Grant permissions
GRANT ALL ON court_case_outcomes TO service_role;
GRANT SELECT ON court_case_outcomes TO authenticated;

-- Verify it was created
SELECT 'Table created successfully!' as status,
       COUNT(*) as row_count
FROM court_case_outcomes;
