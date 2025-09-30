-- Create protection_waitlist table
-- This table stores email signups for the Ticket Protection waitlist

CREATE TABLE IF NOT EXISTS protection_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_protection_waitlist_email ON protection_waitlist(email);

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_protection_waitlist_user_id ON protection_waitlist(user_id);

-- Enable Row Level Security
ALTER TABLE protection_waitlist ENABLE ROW LEVEL SECURITY;

-- Create policy: Allow anyone to insert (for public waitlist form)
CREATE POLICY "Anyone can join waitlist" ON protection_waitlist
  FOR INSERT
  WITH CHECK (true);

-- Create policy: Users can view their own waitlist entries
CREATE POLICY "Users can view own waitlist entries" ON protection_waitlist
  FOR SELECT
  USING (auth.uid() = user_id);

-- Create policy: Admins can view all waitlist entries
CREATE POLICY "Admins can view all waitlist entries" ON protection_waitlist
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.user_id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

COMMENT ON TABLE protection_waitlist IS 'Stores email signups for Ticket Protection premium feature waitlist';
COMMENT ON COLUMN protection_waitlist.user_id IS 'Optional: Links to authenticated user if they signed up while logged in';
COMMENT ON COLUMN protection_waitlist.email IS 'Email address for waitlist notification';