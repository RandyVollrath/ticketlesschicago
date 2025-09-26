-- Create report views for street cleaning notifications
-- These views join user_profiles with street_cleaning_schedule from MyStreetCleaning database

-- First, create a foreign data wrapper to connect to MyStreetCleaning database
-- (Skip this if already exists)
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Create server connection to MyStreetCleaning (if not exists)
-- You'll need to replace the host/dbname/password with actual values
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'msc_server') THEN
        CREATE SERVER msc_server
        FOREIGN DATA WRAPPER postgres_fdw
        OPTIONS (host 'db.zqljxkqdgfibfzdjfjiq.supabase.co', dbname 'postgres', port '5432');
        
        CREATE USER MAPPING FOR CURRENT_USER
        SERVER msc_server
        OPTIONS (user 'postgres', password 'NguoiViet8.');
    END IF;
END
$$;

-- Import the street_cleaning_schedule table as a foreign table
DROP FOREIGN TABLE IF EXISTS msc_street_cleaning_schedule CASCADE;
CREATE FOREIGN TABLE msc_street_cleaning_schedule (
    ward text,
    section text,
    cleaning_date date
)
SERVER msc_server
OPTIONS (schema_name 'public', table_name 'street_cleaning_schedule');

-- Create view for users needing morning-of reminders (0-day)
CREATE OR REPLACE VIEW report_zero_day AS
SELECT DISTINCT
    up.user_id,
    up.email,
    up.phone_number,
    up.home_address_ward,
    up.home_address_section,
    up.home_address_full,
    up.notify_days_array,
    up.phone_call_enabled,
    up.sms_pro,
    up.follow_up_sms,
    up.notification_preferences,
    scs.cleaning_date
FROM user_profiles up
INNER JOIN msc_street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE 
    up.home_address_ward IS NOT NULL
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE
    AND 0 = ANY(COALESCE(up.notify_days_array, ARRAY[1]))
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE);

-- Create view for users needing 1-day before reminders
CREATE OR REPLACE VIEW report_one_day AS
SELECT DISTINCT
    up.user_id,
    up.email,
    up.phone_number,
    up.home_address_ward,
    up.home_address_section,
    up.home_address_full,
    up.notify_days_array,
    up.notify_evening_before,
    up.phone_call_enabled,
    up.sms_pro,
    up.follow_up_sms,
    up.notification_preferences,
    scs.cleaning_date
FROM user_profiles up
INNER JOIN msc_street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE 
    up.home_address_ward IS NOT NULL
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE + INTERVAL '1 day'
    AND (1 = ANY(COALESCE(up.notify_days_array, ARRAY[1])) OR up.notify_evening_before = true)
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE);

-- Create view for follow-up SMS (Pro users only)
CREATE OR REPLACE VIEW report_follow_up AS
SELECT DISTINCT
    up.user_id,
    up.email,
    up.phone_number,
    up.home_address_ward,
    up.home_address_section,
    up.home_address_full,
    up.follow_up_sms,
    up.sms_pro,
    up.notification_preferences,
    scs.cleaning_date
FROM user_profiles up
INNER JOIN msc_street_cleaning_schedule scs 
    ON up.home_address_ward = scs.ward 
    AND up.home_address_section = scs.section
WHERE 
    up.home_address_ward IS NOT NULL
    AND up.home_address_section IS NOT NULL
    AND scs.cleaning_date = CURRENT_DATE
    AND up.sms_pro = true
    AND up.follow_up_sms = true
    AND (up.snooze_until_date IS NULL OR up.snooze_until_date < CURRENT_DATE);

-- Grant permissions
GRANT SELECT ON report_zero_day TO authenticated, anon;
GRANT SELECT ON report_one_day TO authenticated, anon;
GRANT SELECT ON report_follow_up TO authenticated, anon;