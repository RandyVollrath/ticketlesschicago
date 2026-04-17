-- RLS policies for user_parked_vehicles
-- Required for direct Supabase client writes from mobile app background service.
-- Previously only written by service role via /api/mobile/save-parked-location,
-- but that endpoint fails in background contexts due to auth token expiry.

-- INSERT: user can insert rows where user_id matches their auth.uid()
CREATE POLICY "Users can insert own parked vehicles"
  ON public.user_parked_vehicles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- UPDATE: user can deactivate their own rows
CREATE POLICY "Users can update own parked vehicles"
  ON public.user_parked_vehicles FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- SELECT: needed for .select('id') after insert
CREATE POLICY "Users can select own parked vehicles"
  ON public.user_parked_vehicles FOR SELECT TO authenticated
  USING (user_id = auth.uid());
