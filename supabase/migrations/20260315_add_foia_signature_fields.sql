-- Add e-signature and audit trail fields to foia_history_requests
-- These fields capture a legally valid electronic signature per:
-- - Federal ESIGN Act (15 U.S.C. § 7001)
-- - Illinois Electronic Commerce Security Act (815 ILCS 333)
-- - Illinois Uniform Electronic Transactions Act (815 ILCS 334)

ALTER TABLE public.foia_history_requests
  ADD COLUMN IF NOT EXISTS signature_name TEXT,
  ADD COLUMN IF NOT EXISTS signature_agreed_text TEXT,
  ADD COLUMN IF NOT EXISTS signature_user_agent TEXT,
  ADD COLUMN IF NOT EXISTS consent_electronic_process BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.foia_history_requests.signature_name IS 'Full name typed by the user as their electronic signature';
COMMENT ON COLUMN public.foia_history_requests.signature_agreed_text IS 'The exact authorization text the user agreed to at time of signing';
COMMENT ON COLUMN public.foia_history_requests.signature_user_agent IS 'Browser/device user agent string at time of signing';
COMMENT ON COLUMN public.foia_history_requests.consent_electronic_process IS 'User explicitly consented to signing electronically';

-- Also add FOIA evidence authorization fields to user_profiles (for post-signup evidence FOIA)
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS foia_evidence_consent BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS foia_evidence_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS foia_evidence_consent_signature TEXT;

COMMENT ON COLUMN public.user_profiles.foia_evidence_consent IS 'Whether user authorized Autopilot to submit evidence FOIA requests for their tickets';
COMMENT ON COLUMN public.user_profiles.foia_evidence_consent_at IS 'When the FOIA evidence authorization was given';
COMMENT ON COLUMN public.user_profiles.foia_evidence_consent_signature IS 'Typed name used as e-signature for FOIA evidence authorization';
