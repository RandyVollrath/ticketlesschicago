-- Allow anonymous users to insert their signup data into pending_signups
CREATE POLICY "Allow anon insert to pending_signups" ON pending_signups
  FOR INSERT TO anon
  WITH CHECK (true);

-- Allow anonymous users to read their own pending signup by email
CREATE POLICY "Allow anon select pending_signups" ON pending_signups
  FOR SELECT TO anon
  USING (true);

-- Allow authenticated users to delete their own pending signup
CREATE POLICY "Allow authenticated delete pending_signups" ON pending_signups
  FOR DELETE TO authenticated
  USING (true);
