-- Check the actual table structure first
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_name = 'vehicle_reminders' 
  AND table_schema = 'public'
ORDER BY ordinal_position;

-- Then check the actual data
SELECT 
  email,
  license_plate,
  city_sticker_expiry,
  license_plate_expiry,
  emissions_due_date
FROM vehicle_reminders;