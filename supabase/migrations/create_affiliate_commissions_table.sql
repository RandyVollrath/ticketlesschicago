-- Create table to track affiliate commission adjustments
CREATE TABLE IF NOT EXISTS affiliate_commission_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_session_id TEXT UNIQUE NOT NULL,
  customer_email TEXT NOT NULL,
  plan TEXT NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  expected_commission DECIMAL(10,2) NOT NULL,
  referral_id TEXT NOT NULL,
  commission_adjusted BOOLEAN DEFAULT FALSE,
  adjusted_by TEXT,
  adjusted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_affiliate_commission_session ON affiliate_commission_tracker(stripe_session_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_commission_adjusted ON affiliate_commission_tracker(commission_adjusted);

-- Enable RLS
ALTER TABLE affiliate_commission_tracker ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can view/edit
CREATE POLICY "Admin full access to affiliate commissions"
  ON affiliate_commission_tracker
  FOR ALL
  USING (
    auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'carenvollrath@gmail.com')
  );
