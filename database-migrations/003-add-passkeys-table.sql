-- Migration: Add passkeys support table
-- This table stores WebAuthn/Passkey credentials for users

CREATE TABLE IF NOT EXISTS user_passkeys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used TIMESTAMP WITH TIME ZONE,
  name TEXT, -- User-friendly name for the passkey (e.g., "MacBook Touch ID", "iPhone Face ID")
  
  -- Foreign key to auth.users
  CONSTRAINT fk_user_passkeys_user_id 
    FOREIGN KEY (user_id) 
    REFERENCES auth.users(id) 
    ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_passkeys_user_id ON user_passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_user_passkeys_credential_id ON user_passkeys(credential_id);

-- RLS (Row Level Security) policies
ALTER TABLE user_passkeys ENABLE ROW LEVEL SECURITY;

-- Users can only see their own passkeys
CREATE POLICY "Users can view their own passkeys" ON user_passkeys
  FOR SELECT USING (auth.uid() = user_id);

-- Users can only insert their own passkeys
CREATE POLICY "Users can insert their own passkeys" ON user_passkeys
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can only update their own passkeys
CREATE POLICY "Users can update their own passkeys" ON user_passkeys
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can only delete their own passkeys
CREATE POLICY "Users can delete their own passkeys" ON user_passkeys
  FOR DELETE USING (auth.uid() = user_id);

-- Grant access to service role for API endpoints
GRANT ALL ON user_passkeys TO service_role;