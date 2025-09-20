-- DEBUG AND FIX MIGRATION SCRIPT
-- Run this to check what we have and fix the migration

-- First, let's see what tables exist and their structure
SELECT 
  table_name,
  column_name,
  data_type
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'vehicles', 'obligations', 'reminders', 'vehicle_reminders')
ORDER BY table_name, ordinal_position;

-- Check if our new tables were created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('users', 'vehicles', 'obligations', 'reminders');

-- Check what data exists in vehicle_reminders
SELECT 
  COUNT(*) as total_records,
  COUNT(DISTINCT email) as unique_emails,
  COUNT(DISTINCT license_plate) as unique_plates
FROM vehicle_reminders;

-- Sample data from vehicle_reminders to see structure
SELECT 
  email,
  license_plate,
  city_sticker_expiry,
  license_plate_expiry,
  emissions_due_date
FROM vehicle_reminders 
LIMIT 3;