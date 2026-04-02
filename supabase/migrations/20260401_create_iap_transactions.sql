-- Apple In-App Purchase transaction log
-- Records every IAP purchase for idempotency checking and revenue tracking
CREATE TABLE IF NOT EXISTS iap_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  product_id text NOT NULL,
  transaction_id text NOT NULL UNIQUE,
  receipt_data text,
  environment text NOT NULL DEFAULT 'Production',
  amount_cents integer NOT NULL,
  apple_fee_cents integer NOT NULL,
  net_cents integer NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Index for duplicate transaction checks
CREATE INDEX IF NOT EXISTS idx_iap_transactions_transaction_id ON iap_transactions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_iap_transactions_user_id ON iap_transactions(user_id);

-- RLS: users can only see their own transactions
ALTER TABLE iap_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own IAP transactions"
  ON iap_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert (backend verification endpoint)
CREATE POLICY "Service role can insert IAP transactions"
  ON iap_transactions FOR INSERT
  WITH CHECK (true);

-- Add payment_source column to user_profiles if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'user_profiles' AND column_name = 'payment_source'
  ) THEN
    ALTER TABLE user_profiles ADD COLUMN payment_source text;
  END IF;
END $$;
