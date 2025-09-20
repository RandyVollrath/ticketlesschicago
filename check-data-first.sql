-- Let's see exactly what we're dealing with
SELECT 
  email,
  license_plate,
  city_sticker_expiry,
  LENGTH(city_sticker_expiry) as city_length,
  license_plate_expiry,
  LENGTH(license_plate_expiry) as license_length,
  emissions_due_date,
  LENGTH(emissions_due_date) as emissions_length
FROM vehicle_reminders;