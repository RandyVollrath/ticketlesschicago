-- Create protection_interest_survey table
-- Run this to fix the survey submission error

CREATE TABLE IF NOT EXISTS public.protection_interest_survey (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,

  -- Survey responses
  most_important_feature TEXT,
  willing_to_pay TEXT,
  renewal_preference TEXT,
  additional_features TEXT[],
  comments TEXT,

  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  referral_source TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_protection_survey_user_id ON public.protection_interest_survey(user_id);
CREATE INDEX IF NOT EXISTS idx_protection_survey_email ON public.protection_interest_survey(email);
CREATE INDEX IF NOT EXISTS idx_protection_survey_created_at ON public.protection_interest_survey(created_at);

-- RLS policies
ALTER TABLE public.protection_interest_survey ENABLE ROW LEVEL SECURITY;

-- Users can view their own survey responses
CREATE POLICY "Users can view own survey responses" ON public.protection_interest_survey
  FOR SELECT USING (auth.uid() = user_id);

-- Service role has full access
CREATE POLICY "Service role has full access to survey" ON public.protection_interest_survey
  FOR ALL USING (auth.role() = 'service_role');

-- Allow insert for anonymous users (survey can be filled before signup)
CREATE POLICY "Anyone can submit survey" ON public.protection_interest_survey
  FOR INSERT WITH CHECK (true);

-- Success message
SELECT 'Protection interest survey table created!' as status;
