-- Per-renewal explicit consent. Each year's renewal needs a fresh authorization
-- from the user before the automation touches the gov site or charges Stripe.

CREATE TABLE IF NOT EXISTS renewal_purchase_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  renewal_type TEXT NOT NULL CHECK (renewal_type IN ('city_sticker','license_plate')),
  license_plate TEXT,
  license_state TEXT,
  gov_amount_cents INTEGER NOT NULL,
  service_fee_cents INTEGER NOT NULL DEFAULT 0,
  total_amount_cents INTEGER NOT NULL,
  consent_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','granted','declined','expired','consumed','failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  granted_at TIMESTAMPTZ,
  granted_ip TEXT,
  granted_user_agent TEXT,
  declined_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  purchase_result JSONB,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_renewal_consents_user ON renewal_purchase_consents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_renewal_consents_pending ON renewal_purchase_consents (status, expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_renewal_consents_granted ON renewal_purchase_consents (status, granted_at) WHERE status = 'granted';

ALTER TABLE renewal_purchase_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own renewal consents" ON renewal_purchase_consents;
CREATE POLICY "Users read own renewal consents" ON renewal_purchase_consents
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages renewal consents" ON renewal_purchase_consents;
CREATE POLICY "Service role manages renewal consents" ON renewal_purchase_consents
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE renewal_purchase_consents IS
  'Per-renewal explicit consent records. Each cron-generated reminder creates a pending row with a unique token; the user must grant before the automation runs.';
COMMENT ON COLUMN renewal_purchase_consents.status IS
  'pending=created and awaiting user; granted=user authorized; declined=user said no; expired=window closed without action; consumed=automation completed (success or failure); failed=automation tried and failed.';
