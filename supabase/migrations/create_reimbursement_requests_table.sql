-- Create table to track ticket reimbursement requests
CREATE TABLE IF NOT EXISTS reimbursement_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  license_plate TEXT NOT NULL,
  ticket_number TEXT,
  ticket_date DATE NOT NULL,
  ticket_amount DECIMAL(10,2) NOT NULL,
  ticket_type TEXT NOT NULL, -- 'street_cleaning', 'city_sticker', 'license_plate', 'snow_route', 'other'
  ticket_description TEXT,
  front_photo_url TEXT NOT NULL,
  back_photo_url TEXT NOT NULL,
  status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'denied', 'paid'
  reimbursement_amount DECIMAL(10,2),
  admin_notes TEXT,
  processed_by TEXT,
  processed_at TIMESTAMPTZ,
  payment_method TEXT, -- 'venmo', 'paypal', 'check', 'other'
  payment_details TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_reimbursement_user ON reimbursement_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_reimbursement_status ON reimbursement_requests(status);
CREATE INDEX IF NOT EXISTS idx_reimbursement_created ON reimbursement_requests(created_at DESC);

-- Enable RLS
ALTER TABLE reimbursement_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own requests
CREATE POLICY "Users can view own reimbursement requests"
  ON reimbursement_requests
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can create their own requests
CREATE POLICY "Users can create own reimbursement requests"
  ON reimbursement_requests
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can view all requests
CREATE POLICY "Admins can view all reimbursement requests"
  ON reimbursement_requests
  FOR SELECT
  USING (
    auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'carenvollrath@gmail.com')
  );

-- Policy: Admins can update all requests
CREATE POLICY "Admins can update all reimbursement requests"
  ON reimbursement_requests
  FOR UPDATE
  USING (
    auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'carenvollrath@gmail.com')
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_reimbursement_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER update_reimbursement_timestamp
  BEFORE UPDATE ON reimbursement_requests
  FOR EACH ROW
  EXECUTE FUNCTION update_reimbursement_updated_at();
