-- Add user consent tracking for legal compliance
-- Stores explicit authorization for purchasing stickers/permits on user's behalf

CREATE TABLE IF NOT EXISTS user_consents (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,

  -- Consent details
  consent_type TEXT NOT NULL, -- 'protection_purchase', 'permit_zone_authorization', etc.
  consent_text TEXT NOT NULL, -- Exact text of what they agreed to
  consent_granted BOOLEAN NOT NULL DEFAULT true,

  -- Audit trail
  ip_address TEXT,
  user_agent TEXT,
  stripe_session_id TEXT, -- Link to Stripe checkout session

  -- Metadata
  metadata JSONB, -- Additional context (e.g., what services, renewal dates, etc.)

  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for fast lookups
CREATE INDEX idx_user_consents_user_id ON user_consents(user_id);
CREATE INDEX idx_user_consents_type ON user_consents(consent_type);
CREATE INDEX idx_user_consents_created ON user_consents(created_at DESC);

-- Add consent tracking to existing user_profiles
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS consent_protection_purchase TIMESTAMP;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS consent_ip_address TEXT;
