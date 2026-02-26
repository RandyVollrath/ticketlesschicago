-- Add FOIA wait preference to user_profiles
-- Controls whether the system waits for the 5-business-day FOIA response deadline
-- before generating contest letters. Default: 'wait_for_foia' (recommended).
-- Values: 'wait_for_foia' | 'send_immediately'

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS foia_wait_preference TEXT DEFAULT 'wait_for_foia';

-- Add comment for documentation
COMMENT ON COLUMN user_profiles.foia_wait_preference IS
  'Controls contest letter timing relative to FOIA deadline. wait_for_foia (default) delays letter until 5-business-day deadline expires for prima facie argument. send_immediately generates letter as soon as evidence is gathered.';
