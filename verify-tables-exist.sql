-- Run this in Supabase SQL Editor to verify tables exist
-- This checks directly in PostgreSQL, bypassing the API cache

SELECT
  table_name,
  table_schema
FROM information_schema.tables
WHERE table_schema = 'public'
AND table_name IN (
  'court_case_outcomes',
  'win_rate_statistics',
  'attorneys',
  'attorney_case_expertise',
  'attorney_reviews',
  'attorney_quote_requests',
  'ticket_contests'
)
ORDER BY table_name;

-- Also check column counts to verify structure
SELECT
  table_name,
  COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
AND table_name IN (
  'court_case_outcomes',
  'win_rate_statistics',
  'attorneys',
  'attorney_case_expertise',
  'attorney_reviews',
  'attorney_quote_requests',
  'ticket_contests'
)
GROUP BY table_name
ORDER BY table_name;
