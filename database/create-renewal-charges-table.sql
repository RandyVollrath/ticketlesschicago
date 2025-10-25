-- Renewal Charges Table
-- Tracks government renewal fees charged to users when deadlines approach
-- Part of Option B: Remitter service payment model

CREATE TABLE IF NOT EXISTS public.renewal_charges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,

  -- What are we charging for?
  charge_type TEXT NOT NULL CHECK (charge_type IN ('city_sticker', 'license_plate', 'permit')),

  -- Amounts
  amount DECIMAL(10, 2) NOT NULL,
  stripe_fee DECIMAL(10, 2) DEFAULT 0,
  total_charged DECIMAL(10, 2) NOT NULL,

  -- Renewal details
  vehicle_type TEXT, -- For city stickers: PA, PB, SB, MT, LT
  license_plate TEXT,
  renewal_deadline DATE NOT NULL,

  -- Payment status
  status TEXT NOT NULL CHECK (status IN ('pending', 'charged', 'failed', 'refunded', 'remitted')) DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,

  -- Remitter service tracking
  remitted_at TIMESTAMP WITH TIME ZONE,
  remitter_confirmation_number TEXT,
  remitter_status TEXT CHECK (remitter_status IN ('pending', 'submitted', 'approved', 'rejected')),

  -- Notification tracking
  notification_sent BOOLEAN DEFAULT FALSE,
  notification_sent_at TIMESTAMP WITH TIME ZONE,
  charge_email_sent BOOLEAN DEFAULT FALSE,
  charge_email_sent_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  charged_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT,

  -- Audit trail
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_renewal_charges_user_id ON public.renewal_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_status ON public.renewal_charges(status);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_renewal_deadline ON public.renewal_charges(renewal_deadline);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_charge_type ON public.renewal_charges(charge_type);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_created_at ON public.renewal_charges(created_at);

-- Composite index for common query: find pending charges approaching deadline
CREATE INDEX IF NOT EXISTS idx_renewal_charges_pending_deadline
  ON public.renewal_charges(status, renewal_deadline)
  WHERE status = 'pending';

-- Row Level Security
ALTER TABLE public.renewal_charges ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own charges
CREATE POLICY "Users can view their own renewal charges" ON public.renewal_charges
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Service role can insert/update (for cron jobs)
CREATE POLICY "Service role can manage renewal charges" ON public.renewal_charges
  FOR ALL USING (true);

-- Add updated_at trigger
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.renewal_charges
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Grant permissions
GRANT ALL ON public.renewal_charges TO authenticated;
GRANT ALL ON public.renewal_charges TO service_role;

-- Add comments
COMMENT ON TABLE public.renewal_charges IS 'Tracks government renewal fees charged to users when deadlines approach (Option B remitter model)';
COMMENT ON COLUMN public.renewal_charges.charge_type IS 'Type of renewal: city_sticker, license_plate, or permit';
COMMENT ON COLUMN public.renewal_charges.status IS 'Payment status: pending (not charged yet), charged (card charged), failed (charge failed), refunded, remitted (filed with government)';
COMMENT ON COLUMN public.renewal_charges.remitter_status IS 'Status from remitter service: pending, submitted, approved, rejected';
