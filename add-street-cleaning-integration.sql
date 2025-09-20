-- Add street cleaning address field to vehicle_reminders table (current structure)
ALTER TABLE vehicle_reminders 
ADD COLUMN IF NOT EXISTS street_cleaning_address VARCHAR(255);

-- Add comment to explain the field
COMMENT ON COLUMN vehicle_reminders.street_cleaning_address IS 'Address for street cleaning notifications, synced with mystreetcleaning.com';

-- For existing records, default to mailing address if not set
UPDATE vehicle_reminders 
SET street_cleaning_address = mailing_address 
WHERE street_cleaning_address IS NULL AND mailing_address IS NOT NULL;

-- Create integration logging table
CREATE TABLE IF NOT EXISTS msc_integration_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticketless_user_id UUID,
  msc_user_id VARCHAR(255),
  email VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL CHECK (status IN ('success', 'failed', 'retry')),
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_msc_integration_logs_email ON msc_integration_logs(email);
CREATE INDEX IF NOT EXISTS idx_msc_integration_logs_status ON msc_integration_logs(status);
CREATE INDEX IF NOT EXISTS idx_msc_integration_logs_created_at ON msc_integration_logs(created_at);

-- Add comment
COMMENT ON TABLE msc_integration_logs IS 'Logs for tracking mystreetcleaning.com account creation integration';