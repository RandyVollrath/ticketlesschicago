-- Add vehicle make/model/color to user_profiles for vehicle mismatch detection
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS vehicle_color TEXT;

-- Add photo_url and vehicle mismatch columns to detected_tickets
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS vehicle_mismatch_detected BOOLEAN DEFAULT FALSE;
ALTER TABLE detected_tickets ADD COLUMN IF NOT EXISTS vehicle_mismatch_details JSONB;
