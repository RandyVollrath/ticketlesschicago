-- Migration: Add profile confirmation tracking fields
-- Purpose: Track when users confirm their profile is up-to-date before renewals
-- This allows us to stop sending "confirm your info" notifications once confirmed

-- Add profile confirmation timestamp
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS profile_confirmed_at TIMESTAMP WITH TIME ZONE;

-- Add renewal year for which profile was confirmed
-- This ensures users must re-confirm each year
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS profile_confirmed_for_year INTEGER;

-- Add renewal status tracking
-- Values: 'pending', 'confirmed', 'processing', 'purchased', 'shipped', 'applied'
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS renewal_status TEXT DEFAULT 'pending';

-- Track when sticker was purchased
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS sticker_purchased_at TIMESTAMP WITH TIME ZONE;

-- Track expected delivery date
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS sticker_expected_delivery DATE;

-- Create notification_log table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL, -- 'sms', 'email', 'voice', 'web'
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  message_key TEXT, -- For deduplication (e.g., 'sticker_reminder_30_days')
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_notification_log_user_id ON public.notification_log(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_log_type ON public.notification_log(notification_type);
CREATE INDEX IF NOT EXISTS idx_notification_log_sent_at ON public.notification_log(sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_log_message_key ON public.notification_log(message_key);

-- Enable RLS on notification_log
ALTER TABLE public.notification_log ENABLE ROW LEVEL SECURITY;

-- Users can only view their own notifications
CREATE POLICY "Users can view own notifications" ON public.notification_log
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can insert
CREATE POLICY "Service role can insert notifications" ON public.notification_log
  FOR INSERT WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON public.notification_log TO authenticated;
GRANT INSERT ON public.notification_log TO service_role;

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.profile_confirmed_at IS 'When the user last confirmed their profile info is correct';
COMMENT ON COLUMN public.user_profiles.profile_confirmed_for_year IS 'The renewal year for which the profile was confirmed (e.g., 2025)';
COMMENT ON COLUMN public.user_profiles.renewal_status IS 'Current status of the renewal: pending, confirmed, processing, purchased, shipped, applied';
COMMENT ON COLUMN public.user_profiles.sticker_purchased_at IS 'When the city sticker was purchased by the remitter';
COMMENT ON COLUMN public.user_profiles.sticker_expected_delivery IS 'Expected delivery date for the sticker (typically 10 days after purchase)';

COMMENT ON TABLE public.notification_log IS 'Log of all notifications sent to users for tracking and deduplication';
