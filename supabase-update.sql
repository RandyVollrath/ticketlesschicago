-- TicketLess Chicago Database Update
-- Add comprehensive vehicle reminders table to replace simple city_sticker_reminders

-- Create comprehensive vehicle_reminders table
CREATE TABLE IF NOT EXISTS public.vehicle_reminders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  license_plate TEXT NOT NULL,
  vin TEXT,
  zip_code TEXT NOT NULL,
  city_sticker_expiry DATE NOT NULL,
  emissions_due_date DATE,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  reminder_method TEXT CHECK (reminder_method IN ('email', 'sms', 'both')) DEFAULT 'email',
  auto_pay_enabled BOOLEAN DEFAULT FALSE,
  completed BOOLEAN DEFAULT FALSE,
  city_sticker_completed BOOLEAN DEFAULT FALSE,
  emissions_completed BOOLEAN DEFAULT FALSE,
  city_sticker_reminder_sent BOOLEAN DEFAULT FALSE,
  emissions_reminder_sent BOOLEAN DEFAULT FALSE,
  city_sticker_reminder_sent_at TIMESTAMP WITH TIME ZONE,
  emissions_reminder_sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  notes TEXT
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_user_id ON public.vehicle_reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_license_plate ON public.vehicle_reminders(license_plate);
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_city_sticker_expiry ON public.vehicle_reminders(city_sticker_expiry);
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_emissions_due_date ON public.vehicle_reminders(emissions_due_date);
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_completed ON public.vehicle_reminders(completed);
CREATE INDEX IF NOT EXISTS idx_vehicle_reminders_zip_code ON public.vehicle_reminders(zip_code);

-- Set up Row Level Security (RLS) policies
ALTER TABLE public.vehicle_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own vehicle reminders" ON public.vehicle_reminders
  FOR ALL USING (auth.uid() = user_id);

-- Add updated_at trigger
DROP TRIGGER IF EXISTS handle_updated_at ON public.vehicle_reminders;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON public.vehicle_reminders
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- Create updated view for upcoming reminders (both city sticker and emissions)
CREATE OR REPLACE VIEW public.comprehensive_upcoming_reminders AS
WITH city_sticker_reminders AS (
  SELECT 
    vr.id,
    vr.user_id,
    vr.license_plate,
    vr.email,
    vr.phone,
    vr.reminder_method,
    vr.city_sticker_expiry as due_date,
    'city_sticker' as reminder_type,
    vr.city_sticker_completed as completed,
    vr.city_sticker_reminder_sent as reminder_sent,
    (vr.city_sticker_expiry - CURRENT_DATE) as days_until_due
  FROM public.vehicle_reminders vr
  WHERE 
    vr.city_sticker_completed = false 
    AND vr.city_sticker_expiry >= CURRENT_DATE
    AND (vr.city_sticker_expiry - CURRENT_DATE) IN (30, 7, 1, 0)
),
emissions_reminders AS (
  SELECT 
    vr.id,
    vr.user_id,
    vr.license_plate,
    vr.email,
    vr.phone,
    vr.reminder_method,
    vr.emissions_due_date as due_date,
    'emissions' as reminder_type,
    vr.emissions_completed as completed,
    vr.emissions_reminder_sent as reminder_sent,
    (vr.emissions_due_date - CURRENT_DATE) as days_until_due
  FROM public.vehicle_reminders vr
  WHERE 
    vr.emissions_due_date IS NOT NULL
    AND vr.emissions_completed = false 
    AND vr.emissions_due_date >= CURRENT_DATE
    AND (vr.emissions_due_date - CURRENT_DATE) IN (30, 7, 1, 0)
)
SELECT * FROM city_sticker_reminders
UNION ALL
SELECT * FROM emissions_reminders
ORDER BY due_date, reminder_type;

-- Grant permissions
GRANT ALL ON public.vehicle_reminders TO authenticated;