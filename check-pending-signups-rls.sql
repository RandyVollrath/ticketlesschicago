-- Check RLS policies on pending_signups table
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE tablename = 'pending_signups';

-- If no policies allowing anon, add one:
-- CREATE POLICY "Allow anon users to insert pending signups" ON pending_signups
--   FOR INSERT TO anon
--   WITH CHECK (true);
