-- Setup Randy's profile for testing street cleaning notifications
-- Run this in: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/sql

-- First, check what ward/section 1013 W Webster Ave is in
-- 1013 W Webster Ave, Chicago is in Ward 43, Section 7 (Lincoln Park)

INSERT INTO user_profiles (
  email,
  phone_number,
  home_address_full,
  home_address_ward,
  home_address_section,
  notify_days_array,
  notify_evening_before,
  notify_email,
  notify_sms,
  notify_snow,
  notify_winter_parking,
  phone_call_enabled,
  voice_calls_enabled,
  follow_up_sms,
  sms_pro,
  is_paid,
  is_canary,
  role,
  created_at,
  updated_at
) VALUES (
  'randyvollrath@gmail.com',
  '+13125551234', -- UPDATE THIS with your real phone number for SMS
  '1013 W Webster Ave, Chicago, IL 60614',
  '43', -- Ward 43 (Lincoln Park)
  '7',  -- Section 7
  ARRAY[0, 1], -- Notify: same day morning (0) + day before (1)
  true, -- Evening before notification (7pm)
  true, -- Email enabled
  true, -- SMS enabled
  false,
  false,
  false,
  false,
  true, -- Follow-up SMS after cleaning
  true, -- SMS pro
  true, -- Paid user
  true, -- Canary (testing user)
  'user',
  NOW(),
  NOW()
)
ON CONFLICT (email) DO UPDATE SET
  phone_number = EXCLUDED.phone_number,
  home_address_full = EXCLUDED.home_address_full,
  home_address_ward = EXCLUDED.home_address_ward,
  home_address_section = EXCLUDED.home_address_section,
  notify_days_array = EXCLUDED.notify_days_array,
  notify_evening_before = EXCLUDED.notify_evening_before,
  notify_email = EXCLUDED.notify_email,
  notify_sms = EXCLUDED.notify_sms,
  updated_at = NOW();

-- Verify it was created
SELECT
  email,
  home_address_ward,
  home_address_section,
  notify_days_array,
  notify_evening_before,
  notify_email,
  notify_sms
FROM user_profiles
WHERE email = 'randyvollrath@gmail.com';