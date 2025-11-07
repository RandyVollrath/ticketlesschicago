-- Add subscription and payment fields to user_profiles
-- Run this migration to enable subscription-based concierge service

-- Add Stripe payment fields
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT CHECK (subscription_status IN ('active', 'past_due', 'canceled', 'trialing', 'unpaid')) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS subscription_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_canceled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_authorized_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS renewal_notification_days INTEGER DEFAULT 30; -- Platform controls: 30-60 days before expiration

-- Add indexes for Stripe lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer ON user_profiles(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_profiles_subscription_status ON user_profiles(subscription_status);

-- Create table to track renewal charges
CREATE TABLE IF NOT EXISTS renewal_charges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Charge details
  charge_type TEXT NOT NULL CHECK (charge_type IN ('subscription', 'sticker_renewal', 'license_plate_renewal', 'remitter_onetime')),
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'usd',

  -- Stripe IDs
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_invoice_id TEXT, -- For subscription charges

  -- Status tracking
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')) DEFAULT 'pending',
  failure_reason TEXT,
  failure_code TEXT,

  -- For Connect charges (sticker renewals)
  remitter_partner_id UUID REFERENCES renewal_partners(id),
  remitter_received_amount DECIMAL(10, 2),
  platform_fee_amount DECIMAL(10, 2),

  -- Renewal details (for sticker/license plate charges)
  renewal_type TEXT CHECK (renewal_type IN ('city_sticker', 'license_plate', 'both')),
  renewal_due_date DATE,

  -- Notifications
  customer_notified BOOLEAN DEFAULT false,
  notification_sent_at TIMESTAMPTZ,

  -- Timestamps
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  succeeded_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for renewal_charges
CREATE INDEX IF NOT EXISTS idx_renewal_charges_user_id ON renewal_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_status ON renewal_charges(status);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_charge_type ON renewal_charges(charge_type);
CREATE INDEX IF NOT EXISTS idx_renewal_charges_stripe_payment_intent ON renewal_charges(stripe_payment_intent_id);

-- RLS policies for renewal_charges
ALTER TABLE renewal_charges ENABLE ROW LEVEL SECURITY;

-- Users can view their own renewal charges
CREATE POLICY "Users can view own renewal charges" ON renewal_charges
  FOR SELECT USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to renewal charges" ON renewal_charges
  FOR ALL USING (auth.role() = 'service_role');

-- Create table to track failed payment notifications
CREATE TABLE IF NOT EXISTS payment_failure_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  renewal_charge_id UUID REFERENCES renewal_charges(id) ON DELETE CASCADE,

  -- Notification details
  notification_type TEXT NOT NULL CHECK (notification_type IN ('email', 'sms')),
  recipient TEXT NOT NULL, -- Email address or phone number
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'bounced')) DEFAULT 'pending',

  -- Content
  subject TEXT,
  message TEXT,

  -- Delivery tracking
  provider TEXT, -- 'resend' for email, 'twilio' for SMS
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,

  -- Retry logic
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  next_retry_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for payment_failure_notifications
CREATE INDEX IF NOT EXISTS idx_payment_notifications_user_id ON payment_failure_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_charge_id ON payment_failure_notifications(renewal_charge_id);
CREATE INDEX IF NOT EXISTS idx_payment_notifications_status ON payment_failure_notifications(status);

-- RLS policies for payment_failure_notifications
ALTER TABLE payment_failure_notifications ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own payment notifications" ON payment_failure_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to notifications" ON payment_failure_notifications
  FOR ALL USING (auth.role() = 'service_role');

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_renewal_charges_updated_at
  BEFORE UPDATE ON renewal_charges
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_notifications_updated_at
  BEFORE UPDATE ON payment_failure_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Success message
SELECT 'Subscription and payment fields migration completed!' as status;
