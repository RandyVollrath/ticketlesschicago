-- Create views for street cleaning notifications in Ticketless America database
-- Using the actual column names from user_profiles table

-- Create view for users with street cleaning addresses configured
CREATE OR REPLACE VIEW report_users_with_addresses AS
SELECT 
    user_id,
    email,
    phone_number,
    home_address_ward,
    home_address_section,
    home_address_full,
    notify_days_array,
    notify_evening_before,
    phone_call_enabled,
    sms_pro,
    follow_up_sms,
    notify_email,
    notify_sms,
    voice_preference,
    phone_call_time_preference,
    snooze_until_date
FROM user_profiles
WHERE 
    home_address_ward IS NOT NULL
    AND home_address_section IS NOT NULL
    AND (snooze_until_date IS NULL OR snooze_until_date < CURRENT_DATE);

-- View for morning-of reminders (0-day notifications)
CREATE OR REPLACE VIEW report_zero_day AS
SELECT * FROM report_users_with_addresses
WHERE 0 = ANY(COALESCE(notify_days_array, ARRAY[1]));

-- View for 1-day before reminders
CREATE OR REPLACE VIEW report_one_day AS  
SELECT * FROM report_users_with_addresses
WHERE (1 = ANY(COALESCE(notify_days_array, ARRAY[1])) OR notify_evening_before = true);

-- View for follow-up SMS (Pro users only)
CREATE OR REPLACE VIEW report_follow_up AS
SELECT * FROM report_users_with_addresses
WHERE sms_pro = true AND follow_up_sms = true;

-- Grant permissions so the API can query these views
GRANT SELECT ON report_users_with_addresses TO authenticated, anon, service_role;
GRANT SELECT ON report_zero_day TO authenticated, anon, service_role;
GRANT SELECT ON report_one_day TO authenticated, anon, service_role;
GRANT SELECT ON report_follow_up TO authenticated, anon, service_role;