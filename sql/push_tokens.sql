-- Push Notification Tokens Table
-- Stores FCM/APNs tokens for push notifications

CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User reference
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Token details
  token TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),

  -- Device info (for debugging)
  device_id TEXT, -- Unique device identifier
  device_name TEXT, -- e.g., "iPhone 15 Pro", "Pixel 8"
  app_version TEXT, -- e.g., "1.0.0"

  -- Status
  is_active BOOLEAN DEFAULT true,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one token per user per device
  UNIQUE(user_id, device_id)
);

-- Index for efficient token lookup
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);
CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active) WHERE is_active = true;

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_push_tokens_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
DROP TRIGGER IF EXISTS push_tokens_updated_at ON push_tokens;
CREATE TRIGGER push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW
  EXECUTE FUNCTION update_push_tokens_updated_at();

-- Function to register or update a push token
CREATE OR REPLACE FUNCTION register_push_token(
  p_user_id UUID,
  p_token TEXT,
  p_platform TEXT,
  p_device_id TEXT DEFAULT NULL,
  p_device_name TEXT DEFAULT NULL,
  p_app_version TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Upsert: insert or update existing token for this user/device
  INSERT INTO push_tokens (
    user_id, token, platform, device_id, device_name, app_version, is_active, last_used_at
  ) VALUES (
    p_user_id, p_token, p_platform, p_device_id, p_device_name, p_app_version, true, NOW()
  )
  ON CONFLICT (user_id, device_id)
  DO UPDATE SET
    token = EXCLUDED.token,
    platform = EXCLUDED.platform,
    device_name = EXCLUDED.device_name,
    app_version = EXCLUDED.app_version,
    is_active = true,
    last_used_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get active push tokens for a user
CREATE OR REPLACE FUNCTION get_user_push_tokens(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  token TEXT,
  platform TEXT,
  device_name TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT pt.id, pt.token, pt.platform, pt.device_name
  FROM push_tokens pt
  WHERE pt.user_id = p_user_id
    AND pt.is_active = true
  ORDER BY pt.last_used_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to deactivate a push token (when user logs out or token becomes invalid)
CREATE OR REPLACE FUNCTION deactivate_push_token(p_token TEXT)
RETURNS VOID AS $$
BEGIN
  UPDATE push_tokens
  SET is_active = false
  WHERE token = p_token;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see/manage their own tokens
CREATE POLICY "Users can view own push tokens" ON push_tokens
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own push tokens" ON push_tokens
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own push tokens" ON push_tokens
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own push tokens" ON push_tokens
  FOR DELETE USING (auth.uid() = user_id);

-- Service role can do everything
CREATE POLICY "Service role full access to push tokens" ON push_tokens
  FOR ALL USING (auth.jwt()->>'role' = 'service_role');

-- Grant access
GRANT SELECT, INSERT, UPDATE, DELETE ON push_tokens TO authenticated;
GRANT ALL ON push_tokens TO service_role;
