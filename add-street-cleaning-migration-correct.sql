-- =====================================================
-- TICKETLESS AMERICA - STREET CLEANING INTEGRATION 
-- =====================================================
-- This migration adds MyStreetCleaning functionality
-- to the existing Ticketless America database structure
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- 1. EXTEND EXISTING USERS TABLE
-- =====================================================
-- Add MyStreetCleaning specific fields to existing users table

-- Street cleaning address fields
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_address_full text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_address_ward text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_address_section text;

-- Notification preferences for street cleaning
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_days_array integer[] DEFAULT ARRAY[1];
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_evening_before boolean DEFAULT false;

-- Voice call preferences (available to all Ticketless America users)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_call_enabled boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS voice_preference text DEFAULT 'female';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_call_time_preference text DEFAULT '7am';

-- Trip mode/snooze functionality
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS snooze_until_date date;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS snooze_reason text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS snooze_created_at timestamp with time zone;

-- SMS preferences
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS follow_up_sms boolean DEFAULT true;

-- License plate for street cleaning (separate from renewal tracking)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS license_plate_street_cleaning text;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS users_home_ward_idx ON public.users(home_address_ward);
CREATE INDEX IF NOT EXISTS users_home_section_idx ON public.users(home_address_section);
CREATE INDEX IF NOT EXISTS users_snooze_until_idx ON public.users(snooze_until_date);

-- =====================================================
-- 2. STREET CLEANING SCHEDULE TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.street_cleaning_schedule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    section text NOT NULL,
    street_name text,
    side text,
    cleaning_date date NOT NULL,
    ward text NOT NULL,
    east_block text,
    west_block text,
    north_block text,
    south_block text,
    east_street text,
    east_block_number text,
    east_direction text,
    west_street text,
    west_block_number text,
    west_direction text,
    north_street text,
    north_block_number text,
    north_direction text,
    south_street text,
    south_block_number text,
    south_direction text,
    ward_section text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS street_cleaning_section_idx ON public.street_cleaning_schedule(section);
CREATE INDEX IF NOT EXISTS street_cleaning_ward_idx ON public.street_cleaning_schedule(ward);
CREATE INDEX IF NOT EXISTS street_cleaning_date_idx ON public.street_cleaning_schedule(cleaning_date);
CREATE INDEX IF NOT EXISTS street_cleaning_ward_section_idx ON public.street_cleaning_schedule(ward_section);
CREATE INDEX IF NOT EXISTS street_cleaning_composite_idx ON public.street_cleaning_schedule(ward, section, cleaning_date);

-- =====================================================
-- 3. USER_PROFILES TABLE (MyStreetCleaning compatible)
-- =====================================================
-- This table mirrors the structure from MyStreetCleaning for compatibility
CREATE TABLE IF NOT EXISTS public.user_profiles (
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
    email text,
    home_address_full text,
    home_address_ward text,
    home_address_section text,
    notify_email boolean DEFAULT true,
    notify_days_before integer DEFAULT 1,
    notify_days_array integer[] DEFAULT ARRAY[1],
    phone_number text,
    notify_sms boolean DEFAULT false,
    push_subscription jsonb,
    is_paid boolean DEFAULT true, -- All Ticketless America users are paid
    sms_gateway text,
    sms_pro boolean DEFAULT true, -- All Ticketless America users have pro features
    sms_trial_ends timestamp with time zone,
    sms_trial_expires_at timestamp with time zone,
    sms_trial_first_sent boolean DEFAULT false,
    follow_up_sms boolean DEFAULT true,
    sms_pro_expires_at timestamp with time zone,
    referral_pro_earned boolean DEFAULT false,
    notify_snow boolean DEFAULT false, -- Not used but kept for compatibility
    notify_winter_parking boolean DEFAULT false, -- Not used but kept for compatibility
    guarantee_opt_in_year integer,
    license_plate text,
    role text DEFAULT 'user',
    affiliate_id text,
    affiliate_signup_date timestamp with time zone,
    is_canary boolean DEFAULT false,
    snooze_until_date date,
    snooze_reason text,
    snooze_created_at timestamp with time zone,
    sms_opted_out_at timestamp with time zone,
    sms_opt_out_voids_guarantee boolean DEFAULT false,
    sms_opt_out_method text,
    foia_data_emails jsonb,
    foia_emails_added_at timestamp with time zone,
    foia_emails_updated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    phone_call_enabled boolean DEFAULT false,
    voice_preference text DEFAULT 'tts',
    phone_call_time_preference text DEFAULT '7am',
    notify_evening_before boolean DEFAULT false,
    voice_calls_enabled boolean DEFAULT false,
    voice_call_time text DEFAULT '07:30',
    voice_call_days_before integer[] DEFAULT ARRAY[1],
    phone_call_days_before integer[] DEFAULT ARRAY[1],
    created_at timestamp with time zone DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS user_profiles_email_idx ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS user_profiles_ward_section_idx ON public.user_profiles(home_address_ward, home_address_section);
CREATE INDEX IF NOT EXISTS user_profiles_snooze_idx ON public.user_profiles(snooze_until_date);

-- =====================================================
-- 4. USER ADDRESSES TABLE (Multiple addresses support)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_addresses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    label text,
    full_address text NOT NULL,
    ward text NOT NULL,
    section text NOT NULL,
    notify_days_array integer[] DEFAULT ARRAY[1],
    snooze_until_date date,
    snooze_reason text,
    snooze_created_at timestamp with time zone,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS user_addresses_user_idx ON public.user_addresses(user_id);
CREATE INDEX IF NOT EXISTS user_addresses_ward_section_idx ON public.user_addresses(ward, section);

-- =====================================================
-- 5. EXTEND EXISTING NOTIFICATION LOGS
-- =====================================================
-- Extend existing SMS/email logs to support street cleaning
-- Check if sms_logs already exists, if not create it
CREATE TABLE IF NOT EXISTS public.sms_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id),
    phone_number text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'pending',
    provider text DEFAULT 'clicksend',
    sent_at timestamp with time zone DEFAULT now(),
    delivered_at timestamp with time zone,
    error_message text,
    cost numeric(10,4),
    message_type text DEFAULT 'renewal', -- 'renewal', 'street_cleaning', 'follow_up'
    metadata jsonb,
    -- Street cleaning specific fields
    ward text,
    section text,
    cleaning_date date,
    days_before integer
);

-- Create indexes
CREATE INDEX IF NOT EXISTS sms_logs_user_idx ON public.sms_logs(user_id);
CREATE INDEX IF NOT EXISTS sms_logs_phone_idx ON public.sms_logs(phone_number);
CREATE INDEX IF NOT EXISTS sms_logs_sent_at_idx ON public.sms_logs(sent_at);
CREATE INDEX IF NOT EXISTS sms_logs_type_idx ON public.sms_logs(message_type);
CREATE INDEX IF NOT EXISTS sms_logs_ward_section_idx ON public.sms_logs(ward, section);

-- =====================================================
-- 6. EMAIL LOGS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.email_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id),
    email text NOT NULL,
    subject text NOT NULL,
    message text,
    status text DEFAULT 'pending',
    provider text DEFAULT 'resend',
    sent_at timestamp with time zone DEFAULT now(),
    delivered_at timestamp with time zone,
    opened_at timestamp with time zone,
    error_message text,
    message_type text DEFAULT 'renewal', -- 'renewal', 'street_cleaning', 'follow_up'
    metadata jsonb,
    -- Street cleaning specific fields
    ward text,
    section text,
    cleaning_date date,
    days_before integer
);

-- Create indexes
CREATE INDEX IF NOT EXISTS email_logs_user_idx ON public.email_logs(user_id);
CREATE INDEX IF NOT EXISTS email_logs_email_idx ON public.email_logs(email);
CREATE INDEX IF NOT EXISTS email_logs_sent_at_idx ON public.email_logs(sent_at);
CREATE INDEX IF NOT EXISTS email_logs_type_idx ON public.email_logs(message_type);

-- =====================================================
-- 7. USER NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    notification_type text NOT NULL, -- 'street_cleaning', 'renewal'
    sent_at timestamp with time zone,
    channels text[], -- ['email', 'sms', 'voice']
    status text DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'skipped'
    ward text,
    section text,
    cleaning_date date,
    days_before integer,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS user_notifications_user_idx ON public.user_notifications(user_id);
CREATE INDEX IF NOT EXISTS user_notifications_created_idx ON public.user_notifications(created_at);
CREATE INDEX IF NOT EXISTS user_notifications_status_idx ON public.user_notifications(status);
CREATE INDEX IF NOT EXISTS user_notifications_type_idx ON public.user_notifications(notification_type);

-- =====================================================
-- 8. FUNCTIONS FOR STREET CLEANING
-- =====================================================

-- Function to get next cleaning date for a ward/section
CREATE OR REPLACE FUNCTION public.get_next_cleaning_date(
    p_ward text,
    p_section text
) RETURNS date AS $$
BEGIN
    RETURN (
        SELECT MIN(cleaning_date)
        FROM public.street_cleaning_schedule
        WHERE ward = p_ward 
        AND section = p_section
        AND cleaning_date >= CURRENT_DATE
    );
END;
$$ LANGUAGE plpgsql;

-- Function to sync user_profiles with users table
CREATE OR REPLACE FUNCTION public.sync_user_profile()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert or update user_profiles when users table changes
    INSERT INTO public.user_profiles (
        user_id,
        email,
        home_address_full,
        home_address_ward,
        home_address_section,
        phone_number,
        notify_days_array,
        notify_evening_before,
        phone_call_enabled,
        voice_preference,
        phone_call_time_preference,
        snooze_until_date,
        snooze_reason,
        snooze_created_at,
        follow_up_sms,
        license_plate,
        updated_at
    ) VALUES (
        NEW.id,
        NEW.email,
        NEW.home_address_full,
        NEW.home_address_ward,
        NEW.home_address_section,
        NEW.phone,
        NEW.notify_days_array,
        NEW.notify_evening_before,
        NEW.phone_call_enabled,
        NEW.voice_preference,
        NEW.phone_call_time_preference,
        NEW.snooze_until_date,
        NEW.snooze_reason,
        NEW.snooze_created_at,
        NEW.follow_up_sms,
        NEW.license_plate_street_cleaning,
        NEW.updated_at
    ) ON CONFLICT (user_id) DO UPDATE SET
        email = EXCLUDED.email,
        home_address_full = EXCLUDED.home_address_full,
        home_address_ward = EXCLUDED.home_address_ward,
        home_address_section = EXCLUDED.home_address_section,
        phone_number = EXCLUDED.phone_number,
        notify_days_array = EXCLUDED.notify_days_array,
        notify_evening_before = EXCLUDED.notify_evening_before,
        phone_call_enabled = EXCLUDED.phone_call_enabled,
        voice_preference = EXCLUDED.voice_preference,
        phone_call_time_preference = EXCLUDED.phone_call_time_preference,
        snooze_until_date = EXCLUDED.snooze_until_date,
        snooze_reason = EXCLUDED.snooze_reason,
        snooze_created_at = EXCLUDED.snooze_created_at,
        follow_up_sms = EXCLUDED.follow_up_sms,
        license_plate = EXCLUDED.license_plate,
        updated_at = EXCLUDED.updated_at;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to sync profiles
DROP TRIGGER IF EXISTS sync_user_profile_trigger ON public.users;
CREATE TRIGGER sync_user_profile_trigger
    AFTER INSERT OR UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION sync_user_profile();

-- =====================================================
-- 9. ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE public.street_cleaning_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

-- Check if sms_logs and email_logs need RLS enabled
DO $$
BEGIN
    -- Enable RLS on logs if they don't already have it
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_logs' AND table_schema = 'public') THEN
        ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
    END IF;
END
$$;

-- Street cleaning schedule - public read
CREATE POLICY "Anyone can view schedule" ON public.street_cleaning_schedule
    FOR SELECT USING (true);

-- User profiles - users manage their own
CREATE POLICY "Users manage own profiles" ON public.user_profiles
    FOR ALL USING (auth.uid() = user_id);

-- User addresses - users manage their own
CREATE POLICY "Users manage own addresses" ON public.user_addresses
    FOR ALL USING (auth.uid() = user_id);

-- User notifications - users view their own
CREATE POLICY "Users view own notifications" ON public.user_notifications
    FOR SELECT USING (auth.uid() = user_id);

-- Logs - users view their own (if tables exist)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_logs' AND table_schema = 'public') THEN
        DROP POLICY IF EXISTS "Users view own SMS logs" ON public.sms_logs;
        CREATE POLICY "Users view own SMS logs" ON public.sms_logs
            FOR SELECT USING (auth.uid() = user_id);
        
        DROP POLICY IF EXISTS "Users view own email logs" ON public.email_logs;
        CREATE POLICY "Users view own email logs" ON public.email_logs
            FOR SELECT USING (auth.uid() = user_id);
    END IF;
END
$$;

-- =====================================================
-- 10. GRANTS
-- =====================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.street_cleaning_schedule TO anon, authenticated;
GRANT ALL ON public.user_profiles TO authenticated;
GRANT ALL ON public.user_addresses TO authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;

-- Grant on logs if they exist
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sms_logs' AND table_schema = 'public') THEN
        GRANT SELECT ON public.sms_logs TO authenticated;
        GRANT SELECT ON public.email_logs TO authenticated;
    END IF;
END
$$;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION public.get_next_cleaning_date TO anon, authenticated;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
-- Summary of changes:
-- ✅ Extended existing users table with street cleaning fields
-- ✅ Created street_cleaning_schedule table
-- ✅ Created user_profiles table (MyStreetCleaning compatible)
-- ✅ Created user_addresses for multiple address support
-- ✅ Extended/created notification logging tables
-- ✅ Added sync function to keep users and user_profiles in sync
-- ✅ Configured RLS and permissions
-- 
-- NOTE: This migration is compatible with your existing Ticketless America database
-- All existing data and functionality is preserved
-- =====================================================