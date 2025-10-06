-- Table to store incoming SMS messages from users
CREATE TABLE IF NOT EXISTS incoming_sms (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  from_number TEXT NOT NULL,
  message_body TEXT NOT NULL,
  clicksend_message_id TEXT,
  clicksend_data JSONB,
  matched_user_email TEXT,
  processed BOOLEAN DEFAULT FALSE,
  email_sent BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by phone number
CREATE INDEX IF NOT EXISTS idx_incoming_sms_from_number ON incoming_sms(from_number);

-- Index for unprocessed messages
CREATE INDEX IF NOT EXISTS idx_incoming_sms_unprocessed ON incoming_sms(processed) WHERE processed = FALSE;

-- Index for user lookup
CREATE INDEX IF NOT EXISTS idx_incoming_sms_user_id ON incoming_sms(user_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_incoming_sms_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER incoming_sms_updated_at
  BEFORE UPDATE ON incoming_sms
  FOR EACH ROW
  EXECUTE FUNCTION update_incoming_sms_updated_at();

COMMENT ON TABLE incoming_sms IS 'Stores incoming SMS messages from users for profile update requests';
COMMENT ON COLUMN incoming_sms.user_id IS 'Matched user ID based on phone number';
COMMENT ON COLUMN incoming_sms.from_number IS 'Phone number the message came from';
COMMENT ON COLUMN incoming_sms.message_body IS 'Content of the SMS message';
COMMENT ON COLUMN incoming_sms.processed IS 'Whether the message has been reviewed by admin';
COMMENT ON COLUMN incoming_sms.email_sent IS 'Whether notification email was sent to mystreetcleaning@gmail.com';
