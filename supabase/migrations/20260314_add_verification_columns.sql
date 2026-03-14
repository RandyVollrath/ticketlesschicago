-- Add verification columns to permit_zone_user_reports
-- These columns store EXIF GPS verification and Gemini AI verification results

ALTER TABLE public.permit_zone_user_reports
  ADD COLUMN IF NOT EXISTS verification_notes TEXT,
  ADD COLUMN IF NOT EXISTS exif_latitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS exif_longitude DECIMAL(10, 7),
  ADD COLUMN IF NOT EXISTS gps_distance_meters INTEGER,
  ADD COLUMN IF NOT EXISTS ai_extracted_schedule TEXT;

COMMENT ON COLUMN public.permit_zone_user_reports.verification_notes IS
  'Summary of verification checks: GPS proximity + Gemini AI hour extraction';
COMMENT ON COLUMN public.permit_zone_user_reports.exif_latitude IS
  'GPS latitude extracted from photo EXIF metadata';
COMMENT ON COLUMN public.permit_zone_user_reports.exif_longitude IS
  'GPS longitude extracted from photo EXIF metadata';
COMMENT ON COLUMN public.permit_zone_user_reports.gps_distance_meters IS
  'Distance in meters between photo EXIF GPS and stated parking location';
COMMENT ON COLUMN public.permit_zone_user_reports.ai_extracted_schedule IS
  'Hours extracted by Gemini AI from the sign photo (for comparison with user input)';
