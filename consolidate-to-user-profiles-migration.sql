-- =====================================================
-- TICKETLESS AMERICA - CONSOLIDATE TO USER_PROFILES
-- =====================================================
-- This migration makes user_profiles the single source of truth
-- by integrating all Ticketless America functionality into it
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. BACKUP AND ANALYZE CURRENT STATE
-- =====================================================

-- Create temporary backup of current users table
CREATE TABLE IF NOT EXISTS temp_users_backup AS 
SELECT * FROM public.users;

-- =====================================================
-- 2. EXTEND USER_PROFILES TO BE THE COMPLETE USER TABLE
-- =====================================================

-- Add missing Ticketless America fields to user_profiles
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS email_verified boolean DEFAULT false;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS phone_verified boolean DEFAULT false;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS notification_preferences jsonb DEFAULT '{"sms": true, "email": true, "voice": false, "reminder_days": [1]}';

-- Add Ticketless America specific fields
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS first_name text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS last_name text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS zip_code text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS vehicle_type text DEFAULT 'passenger';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS vehicle_year integer;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS vin text;

-- Renewal date fields  
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS city_sticker_expiry date;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS license_plate_expiry date;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS emissions_date date;

-- Address fields for Ticketless America
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS street_address text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS street_side text DEFAULT 'even';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS mailing_address text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS mailing_city text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS mailing_state text DEFAULT 'IL';
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS mailing_zip text;

-- Concierge service fields
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS concierge_service boolean DEFAULT false;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS city_stickers_only boolean DEFAULT true;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS spending_limit integer DEFAULT 500;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'active';

-- Make user_profiles.id the primary key and drop user_id constraint
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_pkey;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_user_id_fkey;

-- Update user_profiles to have proper id as primary key
UPDATE public.user_profiles SET id = user_id WHERE id IS NULL;
ALTER TABLE public.user_profiles ALTER COLUMN id SET NOT NULL;
ALTER TABLE public.user_profiles ADD PRIMARY KEY (id);

-- Copy data from users table to user_profiles for the 14 overlapping records
UPDATE public.user_profiles SET 
    email = COALESCE(users.email, user_profiles.email),
    phone_number = COALESCE(users.phone, user_profiles.phone_number),
    created_at = COALESCE(users.created_at, user_profiles.created_at),
    updated_at = COALESCE(users.updated_at, user_profiles.updated_at),
    email_verified = COALESCE(users.email_verified, user_profiles.email_verified),
    phone_verified = COALESCE(users.phone_verified, user_profiles.phone_verified),
    notification_preferences = COALESCE(users.notification_preferences, user_profiles.notification_preferences)
FROM temp_users_backup users 
WHERE user_profiles.user_id = users.id;

-- =====================================================
-- 3. UPDATE ALL EXISTING TABLES TO REFERENCE USER_PROFILES.ID
-- =====================================================

-- Drop the old user_id column and rename id to replace it
ALTER TABLE public.user_profiles DROP COLUMN IF EXISTS user_id;

-- Update all foreign key references
-- user_addresses
ALTER TABLE public.user_addresses DROP CONSTRAINT IF EXISTS user_addresses_user_id_fkey;
ALTER TABLE public.user_addresses ADD CONSTRAINT user_addresses_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- sms_logs  
ALTER TABLE public.sms_logs DROP CONSTRAINT IF EXISTS sms_logs_user_id_fkey;
ALTER TABLE public.sms_logs ADD CONSTRAINT sms_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- email_logs
ALTER TABLE public.email_logs DROP CONSTRAINT IF EXISTS email_logs_user_id_fkey;
ALTER TABLE public.email_logs ADD CONSTRAINT email_logs_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- user_notifications
ALTER TABLE public.user_notifications DROP CONSTRAINT IF EXISTS user_notifications_user_id_fkey;
ALTER TABLE public.user_notifications ADD CONSTRAINT user_notifications_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- support_tickets  
ALTER TABLE public.support_tickets DROP CONSTRAINT IF EXISTS support_tickets_user_id_fkey;
ALTER TABLE public.support_tickets ADD CONSTRAINT support_tickets_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

-- license_plate_changes
ALTER TABLE public.license_plate_changes DROP CONSTRAINT IF EXISTS license_plate_changes_user_id_fkey;
ALTER TABLE public.license_plate_changes ADD CONSTRAINT license_plate_changes_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;

-- =====================================================
-- 4. CREATE MISSING MYSTREETCLEANING TABLES
-- =====================================================

-- Phone call logs
CREATE TABLE IF NOT EXISTS public.phone_call_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    phone_number text NOT NULL,
    call_type text NOT NULL, -- 'zero_day_reminder', 'one_day_reminder', etc.
    message_content text,
    status text DEFAULT 'pending', -- 'pending', 'sent', 'failed'
    clicksend_message_id text,
    clicksend_status text,
    duration_seconds integer,
    cost numeric(10,4),
    error_message text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Follow up log
CREATE TABLE IF NOT EXISTS public.follow_up_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    cleaning_date date NOT NULL,
    sms_sent boolean DEFAULT false,
    email_sent boolean DEFAULT false,
    sms_response text,
    email_response text,
    created_at timestamp with time zone DEFAULT now()
);

-- Inbound responses (SMS replies)
CREATE TABLE IF NOT EXISTS public.inbound_responses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    phone_number text NOT NULL,
    message_text text NOT NULL,
    received_at timestamp with time zone DEFAULT now(),
    notification_type text -- '0-day', '1-day', etc.
);

-- Data retention policies (GDPR compliance)
CREATE TABLE IF NOT EXISTS public.data_retention_policies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name text NOT NULL UNIQUE,
    retention_period interval NOT NULL, -- e.g., '2 years'
    legal_basis text NOT NULL,
    auto_delete boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Data processing activities (GDPR compliance)
CREATE TABLE IF NOT EXISTS public.data_processing_activities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    activity_name text NOT NULL,
    legal_basis text NOT NULL,
    data_categories text[],
    processing_purposes text[],
    retention_period text,
    third_party_sharing text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- =====================================================
-- 5. CREATE INDEXES FOR PERFORMANCE
-- =====================================================

-- Phone call logs
CREATE INDEX IF NOT EXISTS phone_call_logs_user_idx ON public.phone_call_logs(user_id);
CREATE INDEX IF NOT EXISTS phone_call_logs_created_idx ON public.phone_call_logs(created_at);
CREATE INDEX IF NOT EXISTS phone_call_logs_phone_idx ON public.phone_call_logs(phone_number);

-- Follow up log
CREATE INDEX IF NOT EXISTS follow_up_log_user_idx ON public.follow_up_log(user_id);
CREATE INDEX IF NOT EXISTS follow_up_log_date_idx ON public.follow_up_log(cleaning_date);

-- Inbound responses
CREATE INDEX IF NOT EXISTS inbound_responses_user_idx ON public.inbound_responses(user_id);
CREATE INDEX IF NOT EXISTS inbound_responses_phone_idx ON public.inbound_responses(phone_number);
CREATE INDEX IF NOT EXISTS inbound_responses_received_idx ON public.inbound_responses(received_at);

-- User profiles - additional indexes
CREATE INDEX IF NOT EXISTS user_profiles_email_idx ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS user_profiles_phone_idx ON public.user_profiles(phone_number);
CREATE INDEX IF NOT EXISTS user_profiles_ward_section_idx ON public.user_profiles(home_address_ward, home_address_section);
CREATE INDEX IF NOT EXISTS user_profiles_subscription_idx ON public.user_profiles(subscription_status);
CREATE INDEX IF NOT EXISTS user_profiles_zip_idx ON public.user_profiles(zip_code);

-- =====================================================
-- 6. CREATE REPORT VIEWS FOR NOTIFICATIONS
-- =====================================================

-- Report: Users ready for 0-day reminders
CREATE OR REPLACE VIEW public.report_zero_day AS
SELECT 
    up.id as user_id,
    up.email,
    up.phone_number,
    up.notify_email,
    up.notify_sms as sms_enabled,
    up.phone_call_enabled,
    up.phone_call_days_before,
    up.home_address_full,
    up.home_address_ward,
    up.home_address_section,
    scs.cleaning_date
FROM public.user_profiles up
JOIN public.street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE up.home_address_ward IS NOT NULL 
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE)
    AND ('0' = ANY(up.notify_days_array) OR up.notify_days_array IS NULL);

-- Report: Users ready for 1-day reminders  
CREATE OR REPLACE VIEW public.report_one_day AS
SELECT 
    up.id as user_id,
    up.email,
    up.phone_number,
    up.notify_email,
    up.notify_sms as sms_enabled,
    up.phone_call_enabled,
    up.phone_call_days_before,
    up.home_address_full,
    up.home_address_ward,
    up.home_address_section,
    scs.cleaning_date
FROM public.user_profiles up
JOIN public.street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE up.home_address_ward IS NOT NULL 
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE + INTERVAL '1 day'
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE)
    AND ('1' = ANY(up.notify_days_array) OR up.notify_days_array IS NULL);

-- Report: Users ready for 2-day reminders
CREATE OR REPLACE VIEW public.report_two_day AS
SELECT 
    up.id as user_id,
    up.email,
    up.phone_number,
    up.notify_email,
    up.notify_sms as sms_enabled,
    up.phone_call_enabled,
    up.phone_call_days_before,
    up.home_address_full,
    up.home_address_ward,
    up.home_address_section,
    scs.cleaning_date
FROM public.user_profiles up
JOIN public.street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE up.home_address_ward IS NOT NULL 
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE + INTERVAL '2 days'
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE)
    AND '2' = ANY(up.notify_days_array);

-- Report: Users ready for 3-day reminders
CREATE OR REPLACE VIEW public.report_three_day AS
SELECT 
    up.id as user_id,
    up.email,
    up.phone_number,
    up.notify_email,
    up.notify_sms as sms_enabled,
    up.phone_call_enabled,
    up.phone_call_days_before,
    up.home_address_full,
    up.home_address_ward,
    up.home_address_section,
    scs.cleaning_date
FROM public.user_profiles up
JOIN public.street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE up.home_address_ward IS NOT NULL 
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE + INTERVAL '3 days'
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE)
    AND '3' = ANY(up.notify_days_array);

-- Report: Users ready for follow-up messages
CREATE OR REPLACE VIEW public.report_follow_up AS
SELECT 
    up.id as user_id,
    up.phone_number,
    up.notify_sms as sms_enabled
FROM public.user_profiles up
JOIN public.street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE up.home_address_ward IS NOT NULL 
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE
    AND up.follow_up_sms = true
    AND up.sms_pro = true;

-- Report: Follow-up messages pending
CREATE OR REPLACE VIEW public.report_follow_up_pending AS
SELECT 
    fl.id,
    fl.user_id,
    fl.cleaning_date,
    fl.sms_sent,
    fl.email_sent,
    up.phone_number,
    up.email
FROM public.follow_up_log fl
JOIN public.user_profiles up ON fl.user_id = up.id
WHERE fl.cleaning_date = CURRENT_DATE
    AND (fl.sms_sent = false OR fl.email_sent = false);

-- Report: Users with voided guarantees
CREATE OR REPLACE VIEW public.users_voided_guarantee AS
SELECT 
    up.id as user_id,
    up.email,
    up.phone_number,
    up.sms_opted_out_at,
    up.sms_opt_out_method,
    up.home_address_full,
    up.sms_pro,
    up.sms_trial_expires_at,
    up.notify_sms,
    up.notify_email
FROM public.user_profiles up
WHERE up.sms_opted_out_at IS NOT NULL
    OR up.sms_opt_out_voids_guarantee = true;

-- =====================================================
-- 7. CREATE FUNCTIONS FOR USER_PROFILES
-- =====================================================

-- Function to handle user creation (replaces the old users table trigger)
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger AS $$
BEGIN
    -- Set default values for new users
    NEW.id := COALESCE(NEW.id, gen_random_uuid());
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    NEW.is_paid := COALESCE(NEW.is_paid, true); -- All Ticketless America users are paid
    NEW.sms_pro := COALESCE(NEW.sms_pro, true); -- All Ticketless America users are pro
    NEW.subscription_status := COALESCE(NEW.subscription_status, 'active');
    NEW.role := COALESCE(NEW.role, 'user');
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for new user profiles
DROP TRIGGER IF EXISTS on_user_profile_created ON public.user_profiles;
CREATE TRIGGER on_user_profile_created
    BEFORE INSERT ON public.user_profiles
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_user_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updates
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_user_profile_updated_at();

-- =====================================================
-- 8. UPDATE RLS POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_up_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inbound_responses ENABLE ROW LEVEL SECURITY;

-- User profiles - users can manage their own
DROP POLICY IF EXISTS "Users can view own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users manage own profiles" ON public.user_profiles;

CREATE POLICY "Users can view own profile" ON public.user_profiles
    FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update own profile" ON public.user_profiles
    FOR UPDATE USING (auth.uid()::text = id::text);

CREATE POLICY "Users can insert own profile" ON public.user_profiles
    FOR INSERT WITH CHECK (auth.uid()::text = id::text);

-- Phone call logs - users view their own
CREATE POLICY "Users view own call logs" ON public.phone_call_logs
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- Follow up log - users view their own  
CREATE POLICY "Users view own follow up logs" ON public.follow_up_log
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- Inbound responses - users view their own
CREATE POLICY "Users view own responses" ON public.inbound_responses
    FOR SELECT USING (auth.uid()::text = user_id::text);

-- =====================================================
-- 9. GRANTS AND PERMISSIONS
-- =====================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON public.user_profiles TO authenticated;
GRANT ALL ON public.phone_call_logs TO authenticated;
GRANT ALL ON public.follow_up_log TO authenticated;
GRANT ALL ON public.inbound_responses TO authenticated;
GRANT SELECT ON public.data_retention_policies TO authenticated;
GRANT SELECT ON public.data_processing_activities TO authenticated;

-- Grant access to views
GRANT SELECT ON public.report_zero_day TO authenticated;
GRANT SELECT ON public.report_one_day TO authenticated;
GRANT SELECT ON public.report_two_day TO authenticated;  
GRANT SELECT ON public.report_three_day TO authenticated;
GRANT SELECT ON public.report_follow_up TO authenticated;
GRANT SELECT ON public.report_follow_up_pending TO authenticated;
GRANT SELECT ON public.users_voided_guarantee TO authenticated;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION public.handle_new_user_profile TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_cleaning_date TO anon, authenticated;

-- =====================================================
-- 10. POPULATE DATA RETENTION POLICIES
-- =====================================================

INSERT INTO public.data_retention_policies (table_name, retention_period, legal_basis, auto_delete) VALUES
('sms_logs', '2 years', 'Legitimate business interest', true),
('email_logs', '2 years', 'Legitimate business interest', true),
('phone_call_logs', '2 years', 'Legitimate business interest', true),
('user_notifications', '1 year', 'Legitimate business interest', true),
('inbound_responses', '1 year', 'Legitimate business interest', true),
('follow_up_log', '1 year', 'Legitimate business interest', true),
('support_tickets', '7 years', 'Legal obligation', false),
('license_plate_changes', '7 years', 'Legal obligation', false)
ON CONFLICT (table_name) DO NOTHING;

-- =====================================================
-- 11. CLEAN UP - DROP OLD USERS TABLE
-- =====================================================

-- NOTE: Uncomment these lines after verifying everything works correctly
-- DROP TABLE IF EXISTS public.users CASCADE;
-- DROP TABLE IF EXISTS temp_users_backup;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
-- Summary:
-- ✅ user_profiles is now the single source of truth
-- ✅ All MyStreetCleaning tables created with correct structure
-- ✅ All notification report views created
-- ✅ All foreign keys point to user_profiles.id
-- ✅ RLS policies updated for security
-- ✅ GDPR compliance tables added
-- ✅ Indexes created for performance
-- 
-- Next steps:
-- 1. Update all API endpoints to use user_profiles
-- 2. Update frontend components to use user_profiles
-- 3. Test notification system end-to-end
-- 4. Uncomment DROP TABLE statements after verification
-- =====================================================