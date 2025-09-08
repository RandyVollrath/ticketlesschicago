-- TicketLess Chicago Database Setup
-- Run this in your Supabase SQL editor

-- Enable Row Level Security
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Create users table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  notification_preferences JSONB DEFAULT '{
    "email": true,
    "sms": false,
    "reminder_days": [30, 7, 1]
  }'::jsonb
);

-- Create vehicles table
CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  license_plate TEXT,
  vin TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create city_sticker_reminders table
CREATE TABLE IF NOT EXISTS public.city_sticker_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  renewal_date DATE NOT NULL,
  auto_renew_enabled BOOLEAN DEFAULT FALSE,
  reminder_sent BOOLEAN DEFAULT FALSE,
  reminder_sent_at TIMESTAMP WITH TIME ZONE,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT
);

-- Create auto_renewal_requests table
CREATE TABLE IF NOT EXISTS public.auto_renewal_requests (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  city_sticker_reminder_id UUID REFERENCES public.city_sticker_reminders(id) ON DELETE CASCADE NOT NULL,
  status TEXT CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  cost_estimate DECIMAL(10,2),
  payment_required BOOLEAN DEFAULT TRUE,
  payment_completed BOOLEAN DEFAULT FALSE,
  notes TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_city_sticker_reminders_user_id ON public.city_sticker_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_city_sticker_reminders_renewal_date ON public.city_sticker_reminders(renewal_date);
CREATE INDEX IF NOT EXISTS idx_city_sticker_reminders_completed ON public.city_sticker_reminders(completed);
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON public.vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_renewal_requests_user_id ON public.auto_renewal_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_renewal_requests_status ON public.auto_renewal_requests(status);

-- Set up Row Level Security (RLS) policies

-- Users can only see their own data
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Vehicles policies
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own vehicles" ON public.vehicles
  FOR ALL USING (auth.uid() = user_id);

-- City sticker reminders policies
ALTER TABLE public.city_sticker_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own reminders" ON public.city_sticker_reminders
  FOR ALL USING (auth.uid() = user_id);

-- Auto renewal requests policies
ALTER TABLE public.auto_renewal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own renewal requests" ON public.auto_renewal_requests
  FOR ALL USING (auth.uid() = user_id);

-- Create a function to automatically create a user profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create user profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add updated_at triggers to all tables
DROP TRIGGER IF EXISTS handle_updated_at ON public.users;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at ON public.vehicles;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

DROP TRIGGER IF EXISTS handle_updated_at ON public.city_sticker_reminders;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.city_sticker_reminders
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Create a view for upcoming reminders (for cron job)
CREATE OR REPLACE VIEW public.upcoming_reminders AS
SELECT 
  csr.*,
  u.email,
  u.phone,
  u.notification_preferences,
  (csr.renewal_date - CURRENT_DATE) as days_until_renewal
FROM public.city_sticker_reminders csr
JOIN public.users u ON u.id = csr.user_id
WHERE 
  csr.completed = false 
  AND csr.renewal_date >= CURRENT_DATE
  AND (csr.renewal_date - CURRENT_DATE) IN (30, 7, 1, 0)
ORDER BY csr.renewal_date;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Sample data for testing (remove in production)
-- This will be populated when users sign up through the app