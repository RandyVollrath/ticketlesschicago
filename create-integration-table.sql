-- Create table to track MSC integration attempts
CREATE TABLE IF NOT EXISTS msc_integration_logs (
  id SERIAL PRIMARY KEY,
  ticketless_user_id UUID REFERENCES auth.users(id),
  msc_user_id TEXT,
  email TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
  error TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_msc_integration_logs_email ON msc_integration_logs(email);
CREATE INDEX IF NOT EXISTS idx_msc_integration_logs_ticketless_user_id ON msc_integration_logs(ticketless_user_id);
CREATE INDEX IF NOT EXISTS idx_msc_integration_logs_status ON msc_integration_logs(status);

-- Add RLS policy
ALTER TABLE msc_integration_logs ENABLE ROW LEVEL SECURITY;

-- Policy for admin access only
CREATE POLICY "Admin only access to integration logs" ON msc_integration_logs
FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');