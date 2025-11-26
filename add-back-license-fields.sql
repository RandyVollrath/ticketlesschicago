-- Migration: Add back license image tracking fields
-- Purpose: The upload endpoint tries to save back license info but columns don't exist
-- This migration adds the missing columns to properly track back license images

-- Add back license image path
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS license_image_path_back TEXT;

-- Add back license upload timestamp
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS license_image_back_uploaded_at TIMESTAMP WITH TIME ZONE;

-- Add back license verification status
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS license_image_back_verified BOOLEAN DEFAULT FALSE;

-- Add back license last accessed timestamp (for 48hr deletion countdown)
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS license_back_last_accessed_at TIMESTAMP WITH TIME ZONE;

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.license_image_path_back IS 'Storage path to the back of the driver license image';
COMMENT ON COLUMN public.user_profiles.license_image_back_uploaded_at IS 'When the back license image was uploaded';
COMMENT ON COLUMN public.user_profiles.license_image_back_verified IS 'Whether the back license image has been verified';
COMMENT ON COLUMN public.user_profiles.license_back_last_accessed_at IS 'When a remitter last accessed the back license (starts 48hr deletion countdown for opted-out users)';
