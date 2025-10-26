-- Email Drip Campaign Tracking
-- Tracks which drip emails have been sent to users who opted into marketing

CREATE TABLE IF NOT EXISTS public.drip_campaign_status (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,

  -- Campaign tracking
  campaign_name TEXT NOT NULL DEFAULT 'free_alerts_onboarding',

  -- Email status tracking
  welcome_sent BOOLEAN DEFAULT FALSE,
  welcome_sent_at TIMESTAMP WITH TIME ZONE,

  proof_sent BOOLEAN DEFAULT FALSE,
  proof_sent_at TIMESTAMP WITH TIME ZONE,

  soft_sell_sent BOOLEAN DEFAULT FALSE,
  soft_sell_sent_at TIMESTAMP WITH TIME ZONE,

  -- Engagement tracking
  welcome_opened BOOLEAN DEFAULT FALSE,
  proof_opened BOOLEAN DEFAULT FALSE,
  soft_sell_opened BOOLEAN DEFAULT FALSE,

  -- Conversion tracking
  upgraded_to_protection BOOLEAN DEFAULT FALSE,
  upgraded_at TIMESTAMP WITH TIME ZONE,

  -- Unsubscribe
  unsubscribed BOOLEAN DEFAULT FALSE,
  unsubscribed_at TIMESTAMP WITH TIME ZONE,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_drip_campaign_user_id ON public.drip_campaign_status(user_id);
CREATE INDEX IF NOT EXISTS idx_drip_campaign_email ON public.drip_campaign_status(email);
CREATE INDEX IF NOT EXISTS idx_drip_campaign_created_at ON public.drip_campaign_status(created_at);

-- Composite indexes for cron job queries
CREATE INDEX IF NOT EXISTS idx_drip_campaign_welcome_pending
  ON public.drip_campaign_status(created_at)
  WHERE welcome_sent = FALSE AND unsubscribed = FALSE;

CREATE INDEX IF NOT EXISTS idx_drip_campaign_proof_pending
  ON public.drip_campaign_status(welcome_sent_at)
  WHERE proof_sent = FALSE AND welcome_sent = TRUE AND unsubscribed = FALSE;

CREATE INDEX IF NOT EXISTS idx_drip_campaign_soft_sell_pending
  ON public.drip_campaign_status(welcome_sent_at)
  WHERE soft_sell_sent = FALSE AND welcome_sent = TRUE AND unsubscribed = FALSE;

-- Row Level Security
ALTER TABLE public.drip_campaign_status ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own drip status
CREATE POLICY "Users can view their own drip status" ON public.drip_campaign_status
  FOR SELECT USING (auth.uid() = user_id);

-- Policy: Service role can manage
CREATE POLICY "Service role can manage drip campaign" ON public.drip_campaign_status
  FOR ALL USING (true);

-- Trigger for updated_at
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.drip_campaign_status
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Permissions
GRANT ALL ON public.drip_campaign_status TO authenticated;
GRANT ALL ON public.drip_campaign_status TO service_role;

-- Comments
COMMENT ON TABLE public.drip_campaign_status IS 'Tracks email drip campaign for free alert users who opted into marketing';
COMMENT ON COLUMN public.drip_campaign_status.campaign_name IS 'Campaign identifier (e.g., free_alerts_onboarding)';
COMMENT ON COLUMN public.drip_campaign_status.unsubscribed IS 'User unsubscribed from marketing emails';
