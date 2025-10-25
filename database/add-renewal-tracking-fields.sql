-- Add fields needed for Option B renewal tracking
-- These fields track renewal deadlines and vehicle details

-- Add permit expiry date tracking
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS permit_expiry_date DATE;

-- Add vanity plate flag
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS has_vanity_plate BOOLEAN DEFAULT false;

-- Add vehicle type for city sticker pricing
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS vehicle_type TEXT DEFAULT 'PA' CHECK (vehicle_type IN ('PA', 'PB', 'SB', 'MT', 'LT'));

-- Add comments
COMMENT ON COLUMN public.user_profiles.permit_expiry_date IS 'Residential parking permit expiration date';
COMMENT ON COLUMN public.user_profiles.has_vanity_plate IS 'Whether user has a vanity license plate (affects renewal cost)';
COMMENT ON COLUMN public.user_profiles.vehicle_type IS 'Vehicle type for city sticker: PA (Passenger Auto), PB (Large Passenger), SB (Small Business), MT (Medium Truck), LT (Large Truck)';

-- Create index for permit expiry lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_permit_expiry
  ON public.user_profiles(permit_expiry_date)
  WHERE permit_expiry_date IS NOT NULL;
