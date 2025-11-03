-- Tables for monitoring user parking tickets via Chicago portal

-- Store ticket snapshots for each user
CREATE TABLE IF NOT EXISTS ticket_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  license_plate TEXT NOT NULL,
  license_state TEXT NOT NULL,
  ticket_number TEXT NOT NULL,
  issue_date DATE,
  violation_description TEXT,
  amount DECIMAL(10,2),
  status TEXT, -- unpaid, paid, contested, dismissed
  first_detected_at TIMESTAMPTZ DEFAULT NOW(),
  last_checked_at TIMESTAMPTZ DEFAULT NOW(),
  raw_html TEXT, -- Store proof for disputes
  UNIQUE(user_id, ticket_number)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_ticket_snapshots_user ON ticket_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_snapshots_plate ON ticket_snapshots(license_plate, license_state);
CREATE INDEX IF NOT EXISTS idx_ticket_snapshots_detected ON ticket_snapshots(first_detected_at DESC);

-- Track when we last checked each user's tickets
CREATE TABLE IF NOT EXISTS ticket_check_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  license_plate TEXT NOT NULL,
  license_state TEXT NOT NULL,
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  tickets_found INTEGER DEFAULT 0,
  new_tickets INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT true,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_ticket_check_log_user ON ticket_check_log(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_check_log_checked ON ticket_check_log(checked_at DESC);

-- Track new ticket alerts sent to users
CREATE TABLE IF NOT EXISTS ticket_alerts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_snapshot_id UUID NOT NULL REFERENCES ticket_snapshots(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- email, sms, push
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  success BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_ticket_alerts_user ON ticket_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_alerts_sent ON ticket_alerts(sent_at DESC);

-- RLS Policies
ALTER TABLE ticket_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_check_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_alerts ENABLE ROW LEVEL SECURITY;

-- Users can view their own tickets
CREATE POLICY "Users can view own ticket snapshots"
  ON ticket_snapshots
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can view their own check log
CREATE POLICY "Users can view own check log"
  ON ticket_check_log
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can view their own alerts
CREATE POLICY "Users can view own ticket alerts"
  ON ticket_alerts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Service can insert/update (via service role)
CREATE POLICY "Service can manage ticket snapshots"
  ON ticket_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage check log"
  ON ticket_check_log
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service can manage alerts"
  ON ticket_alerts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
