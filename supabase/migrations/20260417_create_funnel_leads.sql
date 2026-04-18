-- Funnel leads: anonymous pre-auth data captured by /start before signup
-- Keyed by client-generated session_id (UUID stored in localStorage). Service role only.

CREATE TABLE IF NOT EXISTS public.funnel_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  last_step_reached TEXT,

  -- Mirrors user_profiles
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  license_plate TEXT,
  license_state TEXT,
  vehicle_make TEXT,
  vehicle_model TEXT,
  vehicle_color TEXT,
  vehicle_year TEXT,
  home_address_full TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT,
  mailing_zip TEXT,
  city_sticker_expiry DATE,
  plate_expiry DATE,

  -- Mirrors autopilot_settings
  allowed_ticket_types JSONB,
  email_on_ticket_found BOOLEAN,
  email_on_letter_mailed BOOLEAN,
  email_on_approval_needed BOOLEAN,

  -- Funnel state
  billing_plan TEXT,
  consent_checked BOOLEAN,

  -- Conversion
  email TEXT,
  converted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,

  -- Analytics
  user_agent TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT
);

CREATE INDEX IF NOT EXISTS idx_funnel_leads_session_id ON public.funnel_leads(session_id);
CREATE INDEX IF NOT EXISTS idx_funnel_leads_email ON public.funnel_leads(email);
CREATE INDEX IF NOT EXISTS idx_funnel_leads_converted_user_id ON public.funnel_leads(converted_user_id);
CREATE INDEX IF NOT EXISTS idx_funnel_leads_updated_at ON public.funnel_leads(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_funnel_leads_last_step_reached ON public.funnel_leads(last_step_reached);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_funnel_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_funnel_leads_updated_at ON public.funnel_leads;
CREATE TRIGGER trg_funnel_leads_updated_at
  BEFORE UPDATE ON public.funnel_leads
  FOR EACH ROW EXECUTE FUNCTION public.touch_funnel_leads_updated_at();

-- RLS: service role only. No anon/authed access. (Service role bypasses RLS.)
ALTER TABLE public.funnel_leads ENABLE ROW LEVEL SECURITY;
