-- Migration: Add winter overnight parking ban streets and notifications
-- Date: 2025-10-08

-- =====================================================
-- 1. WINTER OVERNIGHT PARKING BAN STREETS TABLE
-- =====================================================
-- Stores the 107 miles of arterial streets with 3am-7am ban (Dec 1 - Apr 1)
CREATE TABLE IF NOT EXISTS public.winter_overnight_parking_ban_streets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  street_name TEXT NOT NULL,
  from_location TEXT NOT NULL,
  to_location TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for street name lookups
CREATE INDEX IF NOT EXISTS winter_ban_streets_name_idx ON public.winter_overnight_parking_ban_streets(street_name);

-- =====================================================
-- 2. USER WINTER BAN NOTIFICATIONS TABLE
-- =====================================================
-- Tracks which users have been notified about winter ban for each season
CREATE TABLE IF NOT EXISTS public.user_winter_ban_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  notification_year INTEGER NOT NULL, -- e.g., 2025 for the 2025-2026 winter season
  notification_date DATE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  channels TEXT[], -- ['email', 'sms']
  status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, notification_year) -- One notification per user per season
);

-- Create indexes
CREATE INDEX IF NOT EXISTS user_winter_ban_notifications_user_idx ON public.user_winter_ban_notifications(user_id);
CREATE INDEX IF NOT EXISTS user_winter_ban_notifications_year_idx ON public.user_winter_ban_notifications(notification_year);

-- =====================================================
-- 3. ADD WINTER BAN PREFERENCE TO USER_PROFILES
-- =====================================================
-- Add field to track if user wants winter ban notifications
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS notify_winter_ban BOOLEAN DEFAULT false;

-- =====================================================
-- 4. INSERT STREET DATA FROM FOIA REQUEST
-- =====================================================
-- Insert the 22 street segments from Chicago FOIA request
INSERT INTO public.winter_overnight_parking_ban_streets (street_name, from_location, to_location)
VALUES
  ('MADISON AVE', 'CANAL STREET', 'DES PLAINES AVE.'),
  ('STATE STREET', '600 SOUTH', '2200 SOUTH'),
  ('CERMAK ROAD', 'STATE STREET', 'Dr M L KING Jr Dr'),
  ('Dr M L KING Jr Dr', '2600 SOUTH', '5500 SOUTH'),
  ('MIDWAY PLAISANCE', 'COTTAGE GROVE', 'DORCHESTER'),
  ('COTTAGE GROVE', 'MIDWAY PLAISANCE', '103RD STREET'),
  ('TORRENCE AVE.', '106TH STREET', '103RD STREET'),
  ('106TH STREET', 'TORRENCE AVE.', 'STATE LINE ROAD'),
  ('ARCHER AVE.', 'STATE STREET', 'HARLEM AVE.'),
  ('KEDZIE AVE.', 'JACKSON BLVD.', '8700 SOUTH'),
  ('79TH STREET', 'CICERO AVE.', 'SOUTH SHORE DRIVE'),
  ('103RD STREET', 'PULASKI RD.', 'TORRENCE AVE.'),
  ('MILWAUKEE AVE', 'CENTRAL AVE.', '400 NORTH'),
  ('DEVON AVE.', 'BROADWAY', 'CLARK STREET'),
  ('CLARK STREET', 'DEVON AVE.', 'HOWARD STREET'),
  ('FOSTER AVE.', 'ASHLAND AVE.', 'CLARK STREET'),
  ('FOSTER AVE.', 'ASHLAND AVE.', '5430 WEST'),
  ('CENTRAL AVE', 'BRYN MAWR AVE.', 'FULLERTON AVE.'),
  ('DIVISION STREET', 'LA SALLE ST.', 'KEDZIE AVE'),
  ('DIVISION STREET', 'HOMAN AVE.', 'AUSTIN AVE.'),
  ('MADISON AVE.', 'AUSTIN AVE.', 'HALSTED STREET'),
  ('CENTRAL AVE.', 'HARRISON ST.', 'FULLERTON AVE.')
ON CONFLICT DO NOTHING;

-- =====================================================
-- 5. HELPER FUNCTION TO CHECK IF ADDRESS IS ON WINTER BAN STREET
-- =====================================================
CREATE OR REPLACE FUNCTION public.is_address_on_winter_ban_street(
  p_full_address TEXT
) RETURNS BOOLEAN AS $$
DECLARE
  v_street_count INTEGER;
BEGIN
  -- Simple check: see if any of the winter ban street names appear in the address
  -- This is a basic implementation - you may want to enhance with geocoding later
  SELECT COUNT(*)
  INTO v_street_count
  FROM public.winter_overnight_parking_ban_streets
  WHERE p_full_address ILIKE '%' || street_name || '%';

  RETURN v_street_count > 0;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 6. ROW LEVEL SECURITY
-- =====================================================
ALTER TABLE public.winter_overnight_parking_ban_streets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_winter_ban_notifications ENABLE ROW LEVEL SECURITY;

-- Winter ban streets - public read
CREATE POLICY "Anyone can view winter ban streets"
  ON public.winter_overnight_parking_ban_streets
  FOR SELECT USING (true);

-- User notifications - users view their own
CREATE POLICY "Users view own winter ban notifications"
  ON public.user_winter_ban_notifications
  FOR SELECT USING (auth.uid() = user_id);

-- =====================================================
-- 7. GRANTS
-- =====================================================
GRANT SELECT ON public.winter_overnight_parking_ban_streets TO anon, authenticated;
GRANT SELECT ON public.user_winter_ban_notifications TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_address_on_winter_ban_street TO anon, authenticated;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
