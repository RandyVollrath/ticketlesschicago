-- Fix RLS policies on users table to allow service role to insert
-- This fixes "Users record was not created successfully" error during OAuth signup

-- First, check if users table exists and has RLS enabled
DO $$
BEGIN
  -- Disable RLS on users table (it's managed via service role, not user auth)
  -- Service role should have full access for system operations like signup
  ALTER TABLE IF EXISTS users DISABLE ROW LEVEL SECURITY;

  RAISE NOTICE 'RLS disabled on users table - service role has full access';
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'users table does not exist yet';
  WHEN OTHERS THEN
    RAISE NOTICE 'Error: %', SQLERRM;
END $$;

-- Alternative: If you want to keep RLS enabled, add a policy for service role
-- Uncomment these lines if you prefer to keep RLS on:

/*
-- Drop existing policies if any
DROP POLICY IF EXISTS "Service role can insert users" ON users;
DROP POLICY IF EXISTS "Service role can update users" ON users;
DROP POLICY IF EXISTS "Service role can select users" ON users;

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role can insert users" ON users
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update users" ON users
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can select users" ON users
  FOR SELECT
  USING (true);

-- Users can only see their own record
CREATE POLICY "Users can view own record" ON users
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own record" ON users
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
*/
