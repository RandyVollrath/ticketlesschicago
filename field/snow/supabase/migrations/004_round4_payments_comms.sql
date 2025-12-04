-- SnowSOS Migration: Round 4 - Payments, Communications, Online State
-- Stripe Connect, Payment Intents, Chat, Online/Offline

-- ===========================================
-- 1. CUSTOMERS - STRIPE INTEGRATION
-- ===========================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_stripe ON customers(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ===========================================
-- 2. SHOVELERS - STRIPE CONNECT & ONLINE STATE
-- ===========================================

-- Stripe Connect fields
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS stripe_connect_account_id TEXT;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS stripe_connect_onboarded BOOLEAN DEFAULT FALSE;

-- Online state (may already exist, but ensure it's there)
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS is_online BOOLEAN DEFAULT FALSE;
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS last_online_at TIMESTAMPTZ;

-- SMS notification preferences
ALTER TABLE shovelers ADD COLUMN IF NOT EXISTS sms_notify_threshold INTEGER DEFAULT 0; -- Notify via SMS for jobs over this amount (0 = disabled)

CREATE INDEX IF NOT EXISTS idx_shovelers_stripe_connect ON shovelers(stripe_connect_account_id) WHERE stripe_connect_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shovelers_online ON shovelers(is_online) WHERE is_online = TRUE;

-- ===========================================
-- 3. JOBS - PAYMENT FIELDS
-- ===========================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS total_price_cents INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS platform_fee_cents INTEGER DEFAULT 0;

-- Add constraint for payment_status
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_payment_status_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_payment_status_check
    CHECK (payment_status IN ('unpaid', 'requires_payment', 'paid', 'refunded'));

CREATE INDEX IF NOT EXISTS idx_jobs_payment_intent ON jobs(payment_intent_id) WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_payment_status ON jobs(payment_status);

-- ===========================================
-- 4. JOB MESSAGES TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS job_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'plower')),
    sender_phone TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id, created_at);

ALTER TABLE job_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job messages full access" ON job_messages FOR ALL USING (true);

-- ===========================================
-- 5. COMMENTS
-- ===========================================

COMMENT ON COLUMN customers.stripe_customer_id IS 'Stripe Customer ID for payment processing';
COMMENT ON COLUMN shovelers.stripe_connect_account_id IS 'Stripe Connect Express account ID for payouts';
COMMENT ON COLUMN shovelers.stripe_connect_onboarded IS 'Whether plower has completed Stripe Connect onboarding';
COMMENT ON COLUMN shovelers.sms_notify_threshold IS 'Notify via SMS for jobs over this amount (0 = disabled)';
COMMENT ON COLUMN jobs.payment_intent_id IS 'Stripe PaymentIntent ID';
COMMENT ON COLUMN jobs.payment_status IS 'Payment status: unpaid, requires_payment, paid, refunded';
COMMENT ON COLUMN jobs.total_price_cents IS 'Total job price in cents';
COMMENT ON COLUMN jobs.platform_fee_cents IS 'Platform fee in cents (10% default)';
COMMENT ON TABLE job_messages IS 'In-app chat messages between customer and plower';
