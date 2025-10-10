-- Create audit_logs table for tracking all critical actions
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

  -- Who performed the action
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What action was performed
  action_type VARCHAR(100) NOT NULL, -- e.g., 'document_reviewed', 'renewal_filed', 'payment_processed', 'profile_updated'
  entity_type VARCHAR(100) NOT NULL, -- e.g., 'permit_document', 'renewal', 'payment', 'user_profile'
  entity_id VARCHAR(255), -- ID of the affected entity

  -- Details of the action
  action_details JSONB, -- Flexible JSON field for action-specific data

  -- Result
  status VARCHAR(50) NOT NULL, -- 'success', 'failure', 'pending'
  error_message TEXT,

  -- Metadata
  ip_address VARCHAR(45), -- IPv4 or IPv6
  user_agent TEXT,

  -- Index for common queries
  INDEX idx_audit_logs_user_id (user_id),
  INDEX idx_audit_logs_action_type (action_type),
  INDEX idx_audit_logs_entity_type_id (entity_type, entity_id),
  INDEX idx_audit_logs_created_at (created_at DESC)
);

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs
CREATE POLICY "Admins can view all audit logs"
  ON audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.is_admin = true
    )
  );

-- System can insert audit logs (via service role)
CREATE POLICY "Service role can insert audit logs"
  ON audit_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON TABLE audit_logs IS 'Audit trail for all critical system actions including document reviews, renewals, payments, and administrative actions';
COMMENT ON COLUMN audit_logs.action_type IS 'Type of action performed (e.g., document_reviewed, renewal_filed, payment_processed)';
COMMENT ON COLUMN audit_logs.action_details IS 'JSON field containing action-specific details (e.g., approval/rejection reasons, payment amounts, etc.)';
COMMENT ON COLUMN audit_logs.status IS 'Outcome of the action: success, failure, or pending';
