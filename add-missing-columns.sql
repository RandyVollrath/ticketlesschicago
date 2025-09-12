-- Add missing columns to vehicle_reminders table
ALTER TABLE public.vehicle_reminders 
ADD COLUMN IF NOT EXISTS subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active';