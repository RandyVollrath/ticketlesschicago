-- Add missing fields to user_profiles table for Ticketless America
-- These fields are needed for complete profile management

-- Personal Information fields
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS first_name TEXT,
ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Vehicle Information fields
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS vin TEXT,
ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
ADD COLUMN IF NOT EXISTS vehicle_year INTEGER,
ADD COLUMN IF NOT EXISTS zip_code TEXT;

-- Renewal Date fields
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS city_sticker_expiry DATE,
ADD COLUMN IF NOT EXISTS license_plate_expiry DATE,
ADD COLUMN IF NOT EXISTS emissions_date DATE;

-- Mailing Address fields
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS mailing_address TEXT,
ADD COLUMN IF NOT EXISTS mailing_city TEXT,
ADD COLUMN IF NOT EXISTS mailing_state TEXT,
ADD COLUMN IF NOT EXISTS mailing_zip TEXT;

-- Add comments for documentation
COMMENT ON COLUMN public.user_profiles.first_name IS 'User first name';
COMMENT ON COLUMN public.user_profiles.last_name IS 'User last name';
COMMENT ON COLUMN public.user_profiles.vin IS 'Vehicle Identification Number';
COMMENT ON COLUMN public.user_profiles.vehicle_type IS 'Type of vehicle (passenger, truck, etc)';
COMMENT ON COLUMN public.user_profiles.vehicle_year IS 'Year of vehicle manufacture';
COMMENT ON COLUMN public.user_profiles.zip_code IS 'ZIP code for vehicle registration';
COMMENT ON COLUMN public.user_profiles.city_sticker_expiry IS 'Chicago city sticker expiration date';
COMMENT ON COLUMN public.user_profiles.license_plate_expiry IS 'License plate renewal date';
COMMENT ON COLUMN public.user_profiles.emissions_date IS 'Emissions test due date';
COMMENT ON COLUMN public.user_profiles.mailing_address IS 'Mailing street address';
COMMENT ON COLUMN public.user_profiles.mailing_city IS 'Mailing city';
COMMENT ON COLUMN public.user_profiles.mailing_state IS 'Mailing state';
COMMENT ON COLUMN public.user_profiles.mailing_zip IS 'Mailing ZIP code';