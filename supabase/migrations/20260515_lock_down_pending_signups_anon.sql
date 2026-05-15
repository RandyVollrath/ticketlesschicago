-- Tighten pending_signups RLS.
--
-- Prior policies let the `anon` role SELECT, INSERT, and DELETE every row in
-- pending_signups with `USING (true)`. Anyone with the public anon key could
-- enumerate every email that had ever started signup and delete other
-- pending rows.
--
-- All app reads/writes to this table go through API routes that use the
-- service-role client (pages/api/pending-signup/save.ts, get.ts). Those
-- routes bypass RLS, so we can drop the anon policies entirely and rely on
-- the API for access control + token validation + rate limiting.

DROP POLICY IF EXISTS "Allow anon insert to pending_signups" ON pending_signups;
DROP POLICY IF EXISTS "Allow anon select pending_signups" ON pending_signups;
DROP POLICY IF EXISTS "Allow authenticated delete pending_signups" ON pending_signups;

ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY;

-- Authenticated users may read only their own pending row (matched by email).
CREATE POLICY "Authenticated user reads own pending row"
  ON pending_signups
  FOR SELECT
  TO authenticated
  USING (email = auth.email());

-- Authenticated users may delete only their own pending row.
CREATE POLICY "Authenticated user deletes own pending row"
  ON pending_signups
  FOR DELETE
  TO authenticated
  USING (email = auth.email());

-- Enable RLS on the two compliance tables that previously had it off, and
-- restrict all access to admins / service-role. App code never reads these
-- from the client.
ALTER TABLE IF EXISTS public.data_processing_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.data_retention_policies ENABLE ROW LEVEL SECURITY;
