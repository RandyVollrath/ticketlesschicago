-- Add payment tracking columns to property_tax_appeals table
-- These columns track Stripe payment status and prevent duplicate payments

-- Add status column if not exists (to track paid vs unpaid)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'property_tax_appeals' AND column_name = 'status'
  ) THEN
    ALTER TABLE property_tax_appeals
    ADD COLUMN status TEXT DEFAULT 'pending';
  END IF;
END $$;

-- Add Stripe payment intent ID
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'property_tax_appeals' AND column_name = 'stripe_payment_intent_id'
  ) THEN
    ALTER TABLE property_tax_appeals
    ADD COLUMN stripe_payment_intent_id TEXT;
  END IF;
END $$;

-- Add Stripe session ID
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'property_tax_appeals' AND column_name = 'stripe_session_id'
  ) THEN
    ALTER TABLE property_tax_appeals
    ADD COLUMN stripe_session_id TEXT;
  END IF;
END $$;

-- Add paid_at timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'property_tax_appeals' AND column_name = 'paid_at'
  ) THEN
    ALTER TABLE property_tax_appeals
    ADD COLUMN paid_at TIMESTAMPTZ;
  END IF;
END $$;

-- Add letter_generated_at timestamp (to track when letter was generated)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'property_tax_appeals' AND column_name = 'letter_generated_at'
  ) THEN
    ALTER TABLE property_tax_appeals
    ADD COLUMN letter_generated_at TIMESTAMPTZ;
  END IF;
END $$;

-- Create unique index on stripe_payment_intent_id to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_tax_appeals_stripe_payment_intent
  ON property_tax_appeals (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Add comment explaining the status values
COMMENT ON COLUMN property_tax_appeals.status IS 'pending = not paid, paid = payment received, letter_generated = letter has been generated';
