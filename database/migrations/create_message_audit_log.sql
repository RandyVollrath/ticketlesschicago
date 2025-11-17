-- Message Audit Log
-- NON-NEGOTIABLE: Every message attempt MUST be logged
-- This prevents disasters and provides full accountability

CREATE TABLE message_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- When this happened
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),

  -- Who was this message for
  user_id UUID REFERENCES user_profiles(user_id),
  user_email TEXT,
  user_phone TEXT,

  -- What type of message
  message_key TEXT NOT NULL,
  -- Examples: 'street_cleaning_1day', 'reg_profile_needed', 'city_sticker_purchased', etc.

  message_channel TEXT NOT NULL CHECK (message_channel IN ('sms', 'email', 'voice', 'push')),

  -- Context data (plate, zone, registration, etc.)
  context_data JSONB NOT NULL DEFAULT '{}',
  -- Example: { "plate": "IL ABC123", "zone": 42, "registration_id": "CHI-123", "days_until": 1 }

  -- What happened
  result TEXT NOT NULL CHECK (result IN ('sent', 'skipped', 'blocked', 'error', 'queued')),

  -- Why this result
  reason TEXT,
  -- Examples: 'already_sent_48h', 'user_opted_out', 'missing_phone', 'api_error', etc.

  -- Error details if failed
  error_details JSONB,

  -- Message content (for audit trail)
  message_preview TEXT,
  -- First 200 chars of actual message sent

  -- Delivery tracking
  external_message_id TEXT,
  -- ClickSend message ID, Resend email ID, etc.

  delivery_status TEXT,
  -- 'delivered', 'failed', 'pending', etc. (updated via webhook)

  delivery_updated_at TIMESTAMP,

  -- Cost tracking
  cost_cents INTEGER,
  -- SMS = ~2 cents, voice = ~5 cents, email = ~0.1 cents

  -- Metadata
  metadata JSONB DEFAULT '{}',

  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for fast queries
CREATE INDEX idx_message_audit_user_id ON message_audit_log(user_id);
CREATE INDEX idx_message_audit_timestamp ON message_audit_log(timestamp DESC);
CREATE INDEX idx_message_audit_message_key ON message_audit_log(message_key);
CREATE INDEX idx_message_audit_result ON message_audit_log(result);
CREATE INDEX idx_message_audit_channel ON message_audit_log(message_channel);
CREATE INDEX idx_message_audit_user_key_timestamp ON message_audit_log(user_id, message_key, timestamp DESC);

-- Composite index for deduplication checks
CREATE INDEX idx_message_audit_dedup ON message_audit_log(user_id, message_key, timestamp DESC)
WHERE result = 'sent';

-- Index for dashboard queries
CREATE INDEX idx_message_audit_dashboard ON message_audit_log(timestamp DESC, result);

-- Comments for documentation
COMMENT ON TABLE message_audit_log IS 'Non-negotiable audit log for every message attempt. Prevents disasters.';
COMMENT ON COLUMN message_audit_log.message_key IS 'Unique identifier for message type (e.g., street_cleaning_1day, reg_profile_needed)';
COMMENT ON COLUMN message_audit_log.context_data IS 'JSON with plate, zone, registration_id, and other context';
COMMENT ON COLUMN message_audit_log.result IS 'What happened: sent, skipped, blocked, error, queued';
COMMENT ON COLUMN message_audit_log.reason IS 'Human-readable reason for the result';
