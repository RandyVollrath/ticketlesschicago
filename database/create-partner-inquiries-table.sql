-- Create partner_inquiries table for fleet partnership requests

CREATE TABLE IF NOT EXISTS partner_inquiries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  fleet_size TEXT NOT NULL,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'new', -- new, contacted, qualified, closed
  notes TEXT
);

-- Create index on created_at for sorting
CREATE INDEX IF NOT EXISTS partner_inquiries_created_at_idx ON partner_inquiries(created_at DESC);

-- Create index on status for filtering
CREATE INDEX IF NOT EXISTS partner_inquiries_status_idx ON partner_inquiries(status);

-- Enable RLS
ALTER TABLE partner_inquiries ENABLE ROW LEVEL SECURITY;

-- Policy: Only authenticated users (admins) can view
CREATE POLICY "Admins can view partner inquiries"
  ON partner_inquiries
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Anyone can insert (for the contact form)
CREATE POLICY "Anyone can submit partner inquiry"
  ON partner_inquiries
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
