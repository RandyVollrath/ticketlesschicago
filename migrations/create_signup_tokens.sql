-- Create signup_tokens table for email forwarding pre-filled signups

CREATE TABLE IF NOT EXISTS signup_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  token TEXT UNIQUE NOT NULL,
  data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  used_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fast token lookup
CREATE INDEX idx_signup_tokens_token ON signup_tokens(token) WHERE NOT used;

-- Index for cleanup of expired tokens
CREATE INDEX idx_signup_tokens_expires ON signup_tokens(expires_at);

-- Function to cleanup expired tokens (run daily)
CREATE OR REPLACE FUNCTION cleanup_expired_signup_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM signup_tokens
  WHERE expires_at < NOW() - INTERVAL '1 day';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;