-- Parking Call Alerts table
-- Logs voice call alerts sent to users when their car is in a ticketable zone.
-- Used for rate limiting (1 call per parking session, 1 per hour per user)
-- and audit trail.

CREATE TABLE IF NOT EXISTS parking_call_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  alert_type text NOT NULL,            -- e.g., 'permit_zone', 'street_cleaning', 'snow_route', 'winter_ban'
  message text NOT NULL,               -- The TTS message that was spoken
  address text,                        -- Where the car was parked
  parking_session_id text,              -- user_parked_vehicles.id (UUID) for dedup
  success boolean NOT NULL DEFAULT false,
  error text,                          -- Error message if call failed
  called_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Index for rate limiting: find recent calls by user
CREATE INDEX IF NOT EXISTS idx_parking_call_alerts_user_time
  ON parking_call_alerts (user_id, called_at DESC);

-- Index for dedup: find calls by parking session
CREATE INDEX IF NOT EXISTS idx_parking_call_alerts_session
  ON parking_call_alerts (user_id, parking_session_id)
  WHERE parking_session_id IS NOT NULL;

-- RLS: all access goes through supabaseAdmin (service role)
ALTER TABLE parking_call_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to parking_call_alerts"
  ON parking_call_alerts
  FOR ALL
  USING (true)
  WITH CHECK (true);
