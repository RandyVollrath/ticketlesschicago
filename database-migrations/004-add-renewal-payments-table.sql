-- Migration: Add renewal payments table for merchant-of-record payment processing
-- Date: 2025-09-29

CREATE TABLE renewal_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES user_profiles(user_id),
  renewal_type TEXT NOT NULL CHECK (renewal_type IN ('city_sticker', 'license_plate', 'emissions')),
  license_plate TEXT NOT NULL,
  renewal_amount DECIMAL(10,2) NOT NULL, -- City fee amount
  service_fee DECIMAL(10,2) NOT NULL, -- Our processing fee
  total_amount DECIMAL(10,2) NOT NULL, -- Total charged to customer
  stripe_payment_intent_id TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  city_payment_status TEXT DEFAULT 'pending' CHECK (city_payment_status IN ('pending', 'paid', 'failed')),
  city_confirmation_number TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  due_date DATE NOT NULL,
  metadata JSONB
);

-- Add indexes for common queries
CREATE INDEX idx_renewal_payments_user_id ON renewal_payments(user_id);
CREATE INDEX idx_renewal_payments_payment_status ON renewal_payments(payment_status);
CREATE INDEX idx_renewal_payments_city_payment_status ON renewal_payments(city_payment_status);
CREATE INDEX idx_renewal_payments_due_date ON renewal_payments(due_date);
CREATE INDEX idx_renewal_payments_stripe_payment_intent ON renewal_payments(stripe_payment_intent_id);

-- Add RLS policy if enabled on other tables
-- ALTER TABLE renewal_payments ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Users can view their own renewal payments" ON renewal_payments FOR SELECT USING (user_id = auth.uid());