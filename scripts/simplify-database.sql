-- Database Simplification Migration
-- Run this after backing up existing data

-- Step 1: Ensure users table has all needed columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences jsonb DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}';

-- Step 2: Migrate any remaining data from other tables to users
-- (Most data should already be in users table from webhook)

-- Step 3: Drop unused tables (after confirming data is migrated)
-- DROP TABLE IF EXISTS user_profiles;
-- DROP TABLE IF EXISTS vehicle_reminders; 
-- DROP TABLE IF EXISTS obligations;
-- DROP TABLE IF EXISTS vehicles;

-- Note: Commented out DROP statements for safety
-- Run these manually after confirming all data is properly migrated