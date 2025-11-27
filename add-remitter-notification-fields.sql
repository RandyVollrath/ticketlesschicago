-- Migration: Add notification fields to renewal_partners
-- Purpose: Allow remitters to receive email notifications about renewals

-- Add notification email (can be different from main email)
ALTER TABLE public.renewal_partners
ADD COLUMN IF NOT EXISTS notification_email TEXT;

-- Add notification preferences
ALTER TABLE public.renewal_partners
ADD COLUMN IF NOT EXISTS notify_daily_digest BOOLEAN DEFAULT TRUE;

ALTER TABLE public.renewal_partners
ADD COLUMN IF NOT EXISTS notify_instant_alerts BOOLEAN DEFAULT TRUE;

ALTER TABLE public.renewal_partners
ADD COLUMN IF NOT EXISTS notify_weekly_summary BOOLEAN DEFAULT TRUE;

-- Track last digest sent (to avoid duplicates)
ALTER TABLE public.renewal_partners
ADD COLUMN IF NOT EXISTS last_digest_sent_at TIMESTAMP WITH TIME ZONE;

-- Add comments
COMMENT ON COLUMN public.renewal_partners.notification_email IS 'Email for renewal notifications (defaults to main email if null)';
COMMENT ON COLUMN public.renewal_partners.notify_daily_digest IS 'Receive daily morning digest of pending renewals';
COMMENT ON COLUMN public.renewal_partners.notify_instant_alerts IS 'Receive instant alerts when users confirm profile or urgent deadlines';
COMMENT ON COLUMN public.renewal_partners.notify_weekly_summary IS 'Receive weekly summary of processed renewals';

-- Update your existing remitter to receive notifications
UPDATE public.renewal_partners
SET notification_email = email,
    notify_daily_digest = true,
    notify_instant_alerts = true
WHERE api_key LIKE 'remitter_%';
