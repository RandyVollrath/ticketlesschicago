-- =====================================================
-- TICKETLESS AMERICA - STREET CLEANING FEATURE MIGRATION
-- =====================================================
-- This migration adds MyStreetCleaning.com functionality
-- to the Ticketless America platform
-- =====================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- Verify PostGIS is installed
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'geometry') THEN
        RAISE EXCEPTION 'PostGIS extension failed to install. Please enable PostGIS in Supabase dashboard first.';
    END IF;
END
$$;

-- =====================================================
-- 1. USER PROFILES EXTENSION
-- =====================================================
-- Add street cleaning specific fields to existing users table

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_address_full text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_address_ward text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS home_address_section text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_days_array integer[] DEFAULT ARRAY[1];
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_evening_before boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_snow boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS notify_winter_parking boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_call_enabled boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS voice_preference text DEFAULT 'female';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_call_time_preference text DEFAULT '7am';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS snooze_until_date date;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS snooze_reason text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS snooze_created_at timestamp with time zone;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_pro boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_pro_expires_at timestamp with time zone;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_trial_expires_at timestamp with time zone;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS sms_trial_first_sent boolean DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS follow_up_sms boolean DEFAULT true;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guarantee_opt_in_year integer;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS license_plate_street_cleaning text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS push_subscription jsonb;

-- Create indexes for street cleaning fields
CREATE INDEX IF NOT EXISTS users_home_ward_idx ON public.users(home_address_ward);
CREATE INDEX IF NOT EXISTS users_home_section_idx ON public.users(home_address_section);
CREATE INDEX IF NOT EXISTS users_sms_pro_idx ON public.users(sms_pro);
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
    geom geometry(Geometry, 4326),
    geom_simplified geometry(Geometry, 4326),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS street_cleaning_section_idx ON public.street_cleaning_schedule(section);
CREATE INDEX IF NOT EXISTS street_cleaning_ward_idx ON public.street_cleaning_schedule(ward);
CREATE INDEX IF NOT EXISTS street_cleaning_date_idx ON public.street_cleaning_schedule(cleaning_date);
CREATE INDEX IF NOT EXISTS street_cleaning_ward_section_idx ON public.street_cleaning_schedule(ward_section);
CREATE INDEX IF NOT EXISTS street_cleaning_composite_idx ON public.street_cleaning_schedule(ward, section, cleaning_date);

-- PostGIS spatial indexes
CREATE INDEX IF NOT EXISTS street_cleaning_geom_idx ON public.street_cleaning_schedule USING GIST(geom);
CREATE INDEX IF NOT EXISTS street_cleaning_geom_simple_idx ON public.street_cleaning_schedule USING GIST(geom_simplified);

-- =====================================================
-- 3. ZONES TABLE (Geographic boundaries)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.zones (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ward text NOT NULL,
    section text NOT NULL,
    geom geometry(Polygon, 4326),
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(ward, section)
);

-- Create spatial index
CREATE INDEX IF NOT EXISTS zones_geom_idx ON public.zones USING GIST(geom);
CREATE INDEX IF NOT EXISTS zones_ward_section_idx ON public.zones(ward, section);

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
-- 5. SMS LOGS TABLE
-- =====================================================
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
    message_type text, -- 'cleaning_reminder', 'follow_up', 'renewal', etc.
    metadata jsonb
);

-- Create indexes
CREATE INDEX IF NOT EXISTS sms_logs_user_idx ON public.sms_logs(user_id);
CREATE INDEX IF NOT EXISTS sms_logs_phone_idx ON public.sms_logs(phone_number);
CREATE INDEX IF NOT EXISTS sms_logs_sent_at_idx ON public.sms_logs(sent_at);
CREATE INDEX IF NOT EXISTS sms_logs_status_idx ON public.sms_logs(status);

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
    message_type text, -- 'cleaning_reminder', 'follow_up', 'renewal', etc.
    metadata jsonb
);

-- Create indexes
CREATE INDEX IF NOT EXISTS email_logs_user_idx ON public.email_logs(user_id);
CREATE INDEX IF NOT EXISTS email_logs_email_idx ON public.email_logs(email);
CREATE INDEX IF NOT EXISTS email_logs_sent_at_idx ON public.email_logs(sent_at);
CREATE INDEX IF NOT EXISTS email_logs_status_idx ON public.email_logs(status);

-- =====================================================
-- 7. USER NOTIFICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    notification_type text NOT NULL, -- 'street_cleaning', 'renewal', 'snow_alert', etc.
    scheduled_for timestamp with time zone NOT NULL,
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
CREATE INDEX IF NOT EXISTS user_notifications_scheduled_idx ON public.user_notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS user_notifications_status_idx ON public.user_notifications(status);
CREATE INDEX IF NOT EXISTS user_notifications_type_idx ON public.user_notifications(notification_type);

-- =====================================================
-- 8. SUPPORT TICKETS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id),
    email text NOT NULL,
    subject text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'open', -- 'open', 'in_progress', 'resolved', 'closed'
    priority text DEFAULT 'normal', -- 'low', 'normal', 'high', 'urgent'
    category text, -- 'billing', 'technical', 'feature_request', 'other'
    assigned_to text,
    resolved_at timestamp with time zone,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS support_tickets_user_idx ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS support_tickets_status_idx ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS support_tickets_created_idx ON public.support_tickets(created_at);

-- =====================================================
-- 9. LICENSE PLATE CHANGES TABLE (Audit trail)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.license_plate_changes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
    old_plate text,
    new_plate text NOT NULL,
    change_reason text,
    changed_by text, -- 'user', 'admin', 'system'
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS plate_changes_user_idx ON public.license_plate_changes(user_id);
CREATE INDEX IF NOT EXISTS plate_changes_created_idx ON public.license_plate_changes(created_at);

-- =====================================================
-- 10. FUNCTIONS
-- =====================================================

-- Function to find section for a given lat/lon point
CREATE OR REPLACE FUNCTION public.find_section_for_point(
    lon numeric,
    lat numeric
) RETURNS TABLE (
    ward text,
    section text
) AS $$
BEGIN
    RETURN QUERY
    SELECT z.ward, z.section
    FROM public.zones z
    WHERE ST_Contains(z.geom, ST_SetSRID(ST_MakePoint(lon, lat), 4326))
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

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

-- Function to find alternative parking zones
CREATE OR REPLACE FUNCTION public.find_alternative_parking(
    p_ward text,
    p_cleaning_date date,
    p_limit integer DEFAULT 5
) RETURNS TABLE (
    ward text,
    section text,
    distance numeric
) AS $$
BEGIN
    RETURN QUERY
    WITH target_zone AS (
        SELECT z.geom
        FROM public.zones z
        WHERE z.ward = p_ward
        LIMIT 1
    )
    SELECT 
        z.ward,
        z.section,
        ST_Distance(z.geom::geography, tz.geom::geography) as distance
    FROM public.zones z, target_zone tz
    WHERE z.ward != p_ward
    AND NOT EXISTS (
        SELECT 1 
        FROM public.street_cleaning_schedule scs
        WHERE scs.ward = z.ward 
        AND scs.section = z.section
        AND scs.cleaning_date = p_cleaning_date
    )
    ORDER BY ST_Distance(z.geom::geography, tz.geom::geography)
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 11. ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS on new tables
ALTER TABLE public.street_cleaning_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.license_plate_changes ENABLE ROW LEVEL SECURITY;

-- Street cleaning schedule - public read
CREATE POLICY "Anyone can view schedule" ON public.street_cleaning_schedule
    FOR SELECT USING (true);

-- Zones - public read
CREATE POLICY "Anyone can view zones" ON public.zones
    FOR SELECT USING (true);

-- User addresses - users manage their own
CREATE POLICY "Users manage own addresses" ON public.user_addresses
    FOR ALL USING (auth.uid() = user_id);

-- SMS logs - users view their own
CREATE POLICY "Users view own SMS logs" ON public.sms_logs
    FOR SELECT USING (auth.uid() = user_id);

-- Email logs - users view their own
CREATE POLICY "Users view own email logs" ON public.email_logs
    FOR SELECT USING (auth.uid() = user_id);

-- User notifications - users view their own
CREATE POLICY "Users view own notifications" ON public.user_notifications
    FOR SELECT USING (auth.uid() = user_id);

-- Support tickets - users manage their own
CREATE POLICY "Users manage own tickets" ON public.support_tickets
    FOR ALL USING (auth.uid() = user_id);

-- License plate changes - users view their own
CREATE POLICY "Users view own plate changes" ON public.license_plate_changes
    FOR SELECT USING (auth.uid() = user_id);

-- =====================================================
-- 12. GRANTS
-- =====================================================

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.street_cleaning_schedule TO anon, authenticated;
GRANT SELECT ON public.zones TO anon, authenticated;
GRANT ALL ON public.user_addresses TO authenticated;
GRANT SELECT ON public.sms_logs TO authenticated;
GRANT SELECT ON public.email_logs TO authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT ALL ON public.support_tickets TO authenticated;
GRANT SELECT ON public.license_plate_changes TO authenticated;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION public.find_section_for_point TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_next_cleaning_date TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_alternative_parking TO anon, authenticated;

-- =====================================================
-- MIGRATION COMPLETE! 🎉
-- =====================================================
-- Summary of changes:
-- ✅ Extended users table with street cleaning fields
-- ✅ Created street_cleaning_schedule table with PostGIS
-- ✅ Created zones table for geographic lookups
-- ✅ Created user_addresses for multiple address support
-- ✅ Created comprehensive logging tables
-- ✅ Created support ticket system
-- ✅ Added spatial lookup functions
-- ✅ Configured RLS and permissions
-- =====================================================