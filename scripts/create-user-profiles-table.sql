-- Create user_profiles table to store additional user data from signup form
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  first_name TEXT,
  last_name TEXT,
  license_plate TEXT,
  vin TEXT,
  zip_code TEXT,
  vehicle_type TEXT DEFAULT 'passenger',
  vehicle_year INTEGER,
  city_sticker_expiry DATE,
  license_plate_expiry DATE,
  emissions_date DATE,
  street_address TEXT,
  mailing_address TEXT,
  mailing_city TEXT,
  mailing_state TEXT DEFAULT 'IL',
  mailing_zip TEXT,
  concierge_service BOOLEAN DEFAULT false,
  city_stickers_only BOOLEAN DEFAULT true,
  spending_limit INTEGER DEFAULT 500,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create RLS policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- Users can view and update their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do everything
CREATE POLICY "Service role has full access" ON user_profiles
  FOR ALL USING (auth.role() = 'service_role');