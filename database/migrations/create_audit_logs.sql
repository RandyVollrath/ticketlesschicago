-- Audit Logs Table
-- Tracks all access to sensitive documents (licenses, bills, tickets)

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who accessed
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accessed_by_user_id UUID REFERENCES auth.users(id), -- Null if accessed by user themselves
  accessed_by_role TEXT, -- 'user', 'admin', 'remitter', 'system'

  -- What was accessed
  action TEXT NOT NULL, -- 'license_uploaded', 'license_accessed', 'license_deleted', 'bill_uploaded', 'bill_accessed', 'bill_deleted', 'ticket_uploaded', 'ticket_accessed'
  resource_type TEXT NOT NULL, -- 'license_front', 'license_back', 'utility_bill', 'ticket_photo'
  resource_path TEXT, -- Storage path

  -- Context
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB, -- Additional context (e.g., remitter company, reason for access)

  -- Outcome
  success BOOLEAN NOT NULL DEFAULT true,
  error_message TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);

-- Index for finding who accessed a specific user's data
CREATE INDEX IF NOT EXISTS idx_audit_logs_accessed_by ON audit_logs(accessed_by_user_id)
WHERE accessed_by_user_id IS NOT NULL;

-- RLS: Users can view their own audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own audit logs"
  ON audit_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can view all logs
CREATE POLICY "Admins can view all audit logs"
  ON audit_logs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

-- Only system (service role) can insert audit logs
CREATE POLICY "Service role can insert audit logs"
  ON audit_logs
  FOR INSERT
  WITH CHECK (true); -- Service role bypasses RLS anyway

-- Nobody can update or delete audit logs (immutable)
CREATE POLICY "Audit logs are immutable"
  ON audit_logs
  FOR UPDATE
  USING (false);

CREATE POLICY "Audit logs cannot be deleted"
  ON audit_logs
  FOR DELETE
  USING (false);

-- Comments
COMMENT ON TABLE audit_logs IS 'Immutable audit trail of all access to sensitive documents';
COMMENT ON COLUMN audit_logs.user_id IS 'The user whose data was accessed';
COMMENT ON COLUMN audit_logs.accessed_by_user_id IS 'The user who performed the access (null if user accessed their own data)';
COMMENT ON COLUMN audit_logs.accessed_by_role IS 'Role of accessor: user, admin, remitter, system';
COMMENT ON COLUMN audit_logs.action IS 'Action performed: *_uploaded, *_accessed, *_deleted';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource: license_front, license_back, utility_bill, ticket_photo';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional context (remitter company, reason, etc.)';
