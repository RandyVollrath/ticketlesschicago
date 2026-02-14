-- Founding plan support + First Dismissal Guarantee workflow

-- Autopilot subscription pricing and lock metadata
ALTER TABLE IF EXISTS public.autopilot_subscriptions
  ADD COLUMN IF NOT EXISTS plan_code text,
  ADD COLUMN IF NOT EXISTS price_cents integer,
  ADD COLUMN IF NOT EXISTS price_lock boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS price_lock_cents integer,
  ADD COLUMN IF NOT EXISTS price_lock_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS grace_period_days integer DEFAULT 7,
  ADD COLUMN IF NOT EXISTS grace_period_ends_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_autopilot_subscriptions_plan_code
  ON public.autopilot_subscriptions(plan_code);

-- First Dismissal Guarantee claims
CREATE TABLE IF NOT EXISTS public.guarantee_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'needs_info', 'approved', 'denied', 'refunded')),
  notes text,
  account_email text,
  account_phone text,
  had_eligible_ticket_contested boolean NOT NULL DEFAULT false,
  ticket_ids text,
  membership_remained_active boolean NOT NULL DEFAULT false,
  docs_provided_on_time boolean NOT NULL DEFAULT false,
  tickets_after_membership_start boolean NOT NULL DEFAULT false,
  deny_reason text,
  reviewed_by text,
  reviewed_at timestamptz,
  refund_amount_cents integer,
  stripe_refund_id text,
  refund_issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guarantee_claims_status
  ON public.guarantee_claims(status);

CREATE INDEX IF NOT EXISTS idx_guarantee_claims_user_id
  ON public.guarantee_claims(user_id);

ALTER TABLE public.guarantee_claims ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.guarantee_claims TO authenticated;
GRANT ALL ON public.guarantee_claims TO service_role;

DROP POLICY IF EXISTS "Users can view own guarantee claims" ON public.guarantee_claims;
CREATE POLICY "Users can view own guarantee claims"
  ON public.guarantee_claims
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own guarantee claims" ON public.guarantee_claims;
CREATE POLICY "Users can create own guarantee claims"
  ON public.guarantee_claims
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all guarantee claims" ON public.guarantee_claims;
CREATE POLICY "Admins can view all guarantee claims"
  ON public.guarantee_claims
  FOR SELECT
  USING (auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'admin@autopilotamerica.com'));

DROP POLICY IF EXISTS "Admins can update guarantee claims" ON public.guarantee_claims;
CREATE POLICY "Admins can update guarantee claims"
  ON public.guarantee_claims
  FOR UPDATE
  USING (auth.jwt() ->> 'email' IN ('randyvollrath@gmail.com', 'admin@autopilotamerica.com'));

CREATE OR REPLACE FUNCTION public.update_guarantee_claims_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_guarantee_claims_updated_at ON public.guarantee_claims;
CREATE TRIGGER trigger_guarantee_claims_updated_at
  BEFORE UPDATE ON public.guarantee_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.update_guarantee_claims_updated_at();

-- Guarantee-eligibility tracking on detected tickets
ALTER TABLE IF EXISTS public.detected_tickets
  ADD COLUMN IF NOT EXISTS violation_class text CHECK (violation_class IN ('camera', 'non_camera')),
  ADD COLUMN IF NOT EXISTS guarantee_covered boolean,
  ADD COLUMN IF NOT EXISTS evidence_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS evidence_on_time boolean;

CREATE INDEX IF NOT EXISTS idx_detected_tickets_violation_class
  ON public.detected_tickets(violation_class);

CREATE INDEX IF NOT EXISTS idx_detected_tickets_guarantee_covered
  ON public.detected_tickets(guarantee_covered);
