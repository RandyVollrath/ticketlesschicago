-- Notification Logs Table
-- Tracks all notification attempts with retry support

CREATE TABLE IF NOT EXISTS notification_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who and what
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  phone TEXT,

  -- Notification details
  notification_type TEXT NOT NULL, -- 'email', 'sms', 'voice', 'push'
  category TEXT NOT NULL, -- 'street_cleaning', 'sticker_renewal', 'plate_renewal', 'emissions', 'towing', 'snow_ban', 'system'
  subject TEXT, -- Email subject or notification title
  content_preview TEXT, -- First 200 chars of message for debugging

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'delivered', 'failed', 'bounced', 'retry_scheduled'

  -- Retry logic
  attempt_count INTEGER DEFAULT 1,
  max_attempts INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,

  -- External IDs (for tracking delivery)
  external_id TEXT, -- Resend message ID, ClickSend message ID, etc.

  -- Metadata
  metadata JSONB DEFAULT '{}', -- Additional context (obligation_id, vehicle info, etc.)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_notification_logs_user_id ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created_at ON notification_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_retry ON notification_logs(next_retry_at) WHERE status = 'retry_scheduled';
CREATE INDEX IF NOT EXISTS idx_notification_logs_category ON notification_logs(category);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notification_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS notification_logs_updated_at ON notification_logs;
CREATE TRIGGER notification_logs_updated_at
  BEFORE UPDATE ON notification_logs
  FOR EACH ROW
  EXECUTE FUNCTION update_notification_logs_updated_at();

-- Function to log a notification attempt
CREATE OR REPLACE FUNCTION log_notification(
  p_user_id UUID,
  p_email TEXT,
  p_phone TEXT,
  p_notification_type TEXT,
  p_category TEXT,
  p_subject TEXT,
  p_content_preview TEXT,
  p_status TEXT DEFAULT 'pending',
  p_external_id TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO notification_logs (
    user_id, email, phone, notification_type, category,
    subject, content_preview, status, external_id, metadata
  ) VALUES (
    p_user_id, p_email, p_phone, p_notification_type, p_category,
    p_subject, p_content_preview, p_status, p_external_id, p_metadata
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update notification status
CREATE OR REPLACE FUNCTION update_notification_status(
  p_id UUID,
  p_status TEXT,
  p_external_id TEXT DEFAULT NULL,
  p_error TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE notification_logs
  SET
    status = p_status,
    external_id = COALESCE(p_external_id, external_id),
    last_error = p_error,
    sent_at = CASE WHEN p_status = 'sent' THEN NOW() ELSE sent_at END,
    delivered_at = CASE WHEN p_status = 'delivered' THEN NOW() ELSE delivered_at END,
    failed_at = CASE WHEN p_status IN ('failed', 'bounced') THEN NOW() ELSE failed_at END,
    -- Schedule retry if failed and under max attempts
    next_retry_at = CASE
      WHEN p_status = 'failed' AND attempt_count < max_attempts
      THEN NOW() + (POWER(2, attempt_count) * INTERVAL '5 minutes') -- Exponential backoff: 5min, 10min, 20min
      ELSE NULL
    END,
    status = CASE
      WHEN p_status = 'failed' AND attempt_count < max_attempts
      THEN 'retry_scheduled'
      ELSE p_status
    END
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get notifications ready for retry
CREATE OR REPLACE FUNCTION get_pending_retries(p_limit INTEGER DEFAULT 50)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  email TEXT,
  phone TEXT,
  notification_type TEXT,
  category TEXT,
  subject TEXT,
  content_preview TEXT,
  attempt_count INTEGER,
  metadata JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    nl.id, nl.user_id, nl.email, nl.phone, nl.notification_type,
    nl.category, nl.subject, nl.content_preview, nl.attempt_count, nl.metadata
  FROM notification_logs nl
  WHERE nl.status = 'retry_scheduled'
    AND nl.next_retry_at <= NOW()
  ORDER BY nl.next_retry_at ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to increment retry attempt
CREATE OR REPLACE FUNCTION increment_retry_attempt(p_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE notification_logs
  SET attempt_count = attempt_count + 1
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- View for notification statistics (useful for dashboards)
CREATE OR REPLACE VIEW notification_stats AS
SELECT
  DATE_TRUNC('day', created_at) as date,
  notification_type,
  category,
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE status = 'sent' OR status = 'delivered') as successful,
  COUNT(*) FILTER (WHERE status = 'failed' OR status = 'bounced') as failed,
  COUNT(*) FILTER (WHERE status = 'retry_scheduled') as pending_retry
FROM notification_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at), notification_type, category
ORDER BY date DESC, notification_type, category;

-- RLS Policies
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notification logs
CREATE POLICY "Users can view own notification logs" ON notification_logs
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can do everything
CREATE POLICY "Service role full access" ON notification_logs
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Grant access
GRANT SELECT ON notification_logs TO authenticated;
GRANT ALL ON notification_logs TO service_role;
GRANT SELECT ON notification_stats TO authenticated;
GRANT SELECT ON notification_stats TO service_role;
