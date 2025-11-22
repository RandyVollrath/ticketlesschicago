-- Fix OAuth user creation by making all user_profiles columns nullable
-- This prevents "Database error saving new user" when Supabase auto-creates profiles

-- Make all potentially problematic columns nullable
ALTER TABLE user_profiles ALTER COLUMN email DROP NOT NULL;
ALTER TABLE user_profiles ALTER COLUMN phone_number DROP NOT NULL;
ALTER TABLE user_profiles ALTER COLUMN license_plate DROP NOT NULL;
ALTER TABLE user_profiles ALTER COLUMN zip_code DROP NOT NULL;

-- Add defaults where helpful
ALTER TABLE user_profiles ALTER COLUMN notify_email SET DEFAULT true;
ALTER TABLE user_profiles ALTER COLUMN notify_sms SET DEFAULT false;
ALTER TABLE user_profiles ALTER COLUMN has_protection SET DEFAULT false;
ALTER TABLE user_profiles ALTER COLUMN is_paid SET DEFAULT false;

-- Ensure user_id is the only required field (it's the primary key)
-- Email can be populated later from auth.users

-- Drop any problematic triggers that might be causing issues
-- (This won't error if they don't exist)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS create_profile_for_new_user ON auth.users;
