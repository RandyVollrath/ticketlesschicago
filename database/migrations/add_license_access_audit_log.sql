-- License Access Audit Log
-- Tracks every time a license image is accessed, by whom, and for what reason
-- Provides transparency to users and helps detect unusual access patterns

-- Create audit log table
CREATE TABLE IF NOT EXISTS license_access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accessed_by TEXT NOT NULL, -- 'remitter_automation', 'support_staff', 'user_self', etc.
  reason TEXT NOT NULL, -- 'city_sticker_renewal', 'support_request', 'user_download', etc.
  ip_address TEXT,
  user_agent TEXT,
  license_image_path TEXT, -- Which file was accessed
  request_id TEXT, -- Optional: for correlating with application logs
  metadata JSONB -- Additional context (e.g., { "renewal_type": "city_sticker", "remitter_id": "xyz" })
);

-- Indexes for fast querying
CREATE INDEX idx_license_access_log_user_id ON license_access_log(user_id);
CREATE INDEX idx_license_access_log_accessed_at ON license_access_log(accessed_at DESC);
CREATE INDEX idx_license_access_log_accessed_by ON license_access_log(accessed_by);
CREATE INDEX idx_license_access_log_reason ON license_access_log(reason);

-- Enable Row Level Security
ALTER TABLE license_access_log ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own access logs
CREATE POLICY "Users can view their own access logs"
  ON license_access_log
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can insert/view all logs
CREATE POLICY "Service role can manage all logs"
  ON license_access_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- Function to get user's recent access history
CREATE OR REPLACE FUNCTION get_license_access_history(target_user_id UUID, limit_count INT DEFAULT 10)
RETURNS TABLE (
  accessed_at TIMESTAMPTZ,
  accessed_by TEXT,
  reason TEXT,
  days_ago INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.accessed_at,
    l.accessed_by,
    l.reason,
    EXTRACT(DAY FROM NOW() - l.accessed_at)::INT as days_ago
  FROM license_access_log l
  WHERE l.user_id = target_user_id
  ORDER BY l.accessed_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to detect unusual access patterns
CREATE OR REPLACE FUNCTION detect_unusual_license_access(target_user_id UUID)
RETURNS TABLE (
  alert_type TEXT,
  alert_message TEXT,
  access_count INT
) AS $$
DECLARE
  access_count_24h INT;
  access_count_7d INT;
  last_access_reason TEXT;
BEGIN
  -- Count accesses in last 24 hours
  SELECT COUNT(*) INTO access_count_24h
  FROM license_access_log
  WHERE user_id = target_user_id
    AND accessed_at > NOW() - INTERVAL '24 hours';

  -- Count accesses in last 7 days
  SELECT COUNT(*) INTO access_count_7d
  FROM license_access_log
  WHERE user_id = target_user_id
    AND accessed_at > NOW() - INTERVAL '7 days';

  -- Get last access reason
  SELECT reason INTO last_access_reason
  FROM license_access_log
  WHERE user_id = target_user_id
  ORDER BY accessed_at DESC
  LIMIT 1;

  -- Alert if more than 3 accesses in 24 hours
  IF access_count_24h > 3 THEN
    RETURN QUERY SELECT
      'high_frequency_24h'::TEXT,
      format('License accessed %s times in last 24 hours', access_count_24h),
      access_count_24h;
  END IF;

  -- Alert if more than 5 accesses in 7 days (renewals are ~yearly, so this is unusual)
  IF access_count_7d > 5 THEN
    RETURN QUERY SELECT
      'high_frequency_7d'::TEXT,
      format('License accessed %s times in last 7 days', access_count_7d),
      access_count_7d;
  END IF;

  -- If no alerts, return null
  IF access_count_24h <= 3 AND access_count_7d <= 5 THEN
    RETURN QUERY SELECT
      'normal'::TEXT,
      'Access pattern is normal'::TEXT,
      access_count_7d;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Comments
COMMENT ON TABLE license_access_log IS 'Audit log for all driver''s license image accesses - provides transparency and security monitoring';
COMMENT ON COLUMN license_access_log.accessed_by IS 'Who accessed: remitter_automation, support_staff, user_self, admin_debug';
COMMENT ON COLUMN license_access_log.reason IS 'Why accessed: city_sticker_renewal, license_plate_renewal, support_request, user_download, verification';
COMMENT ON COLUMN license_access_log.metadata IS 'Additional context in JSON format';

-- Example queries:
--
-- Get user's access history:
-- SELECT * FROM get_license_access_history('user-uuid', 10);
--
-- Check for unusual access:
-- SELECT * FROM detect_unusual_license_access('user-uuid');
--
-- Get all accesses by remitter in last 30 days:
-- SELECT user_id, accessed_at, reason
-- FROM license_access_log
-- WHERE accessed_by = 'remitter_automation'
--   AND accessed_at > NOW() - INTERVAL '30 days'
-- ORDER BY accessed_at DESC;
