-- BULLETPROOF DATABASE MIGRATION SCRIPT
-- This handles all edge cases with dates

-- ============================================
-- STEP 1: DROP EXISTING TABLES AND START FRESH
-- ============================================

-- Drop views first (they depend on tables)
DROP VIEW IF EXISTS upcoming_obligations CASCADE;
DROP VIEW IF EXISTS overdue_obligations CASCADE;
DROP VIEW IF EXISTS all_upcoming_obligations CASCADE;

-- Drop functions
DROP FUNCTION IF EXISTS get_obligations_needing_reminders(INTEGER) CASCADE;
DROP FUNCTION IF EXISTS log_reminder(UUID, UUID, VARCHAR, INTEGER, VARCHAR, TEXT) CASCADE;

-- Drop new tables if they exist (to start clean)
DROP TABLE IF EXISTS reminders CASCADE;
DROP TABLE IF EXISTS obligations CASCADE;
DROP TABLE IF EXISTS vehicles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- STEP 2: CREATE NEW CLEAN TABLES
-- ============================================

-- Users: Core user data
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  notification_preferences JSONB DEFAULT '{"sms": false, "email": true, "voice": false, "reminder_days": [30, 14, 7, 3, 1, 0]}'::jsonb
);

-- Vehicles: User-owned vehicles  
CREATE TABLE vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  license_plate VARCHAR(20) NOT NULL,
  vin VARCHAR(17),
  year INTEGER,
  make VARCHAR(50),
  model VARCHAR(50),
  zip_code VARCHAR(10),
  mailing_address VARCHAR(255),
  mailing_city VARCHAR(100),
  mailing_state VARCHAR(2),
  mailing_zip VARCHAR(10),
  subscription_id VARCHAR(255),
  subscription_status VARCHAR(20) DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, license_plate)
);

-- Obligations: All compliance deadlines
CREATE TABLE obligations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'city_sticker', 'emissions', 'license_plate'
  due_date DATE NOT NULL,
  auto_renew_enabled BOOLEAN DEFAULT FALSE,
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(vehicle_id, type, due_date)
);

-- Reminders: Log of sent reminders
CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID REFERENCES obligations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  method VARCHAR(20) NOT NULL, -- 'email', 'sms', 'voice'
  days_until_due INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT
);

-- ============================================
-- STEP 3: MIGRATE DATA FROM OLD STRUCTURE
-- ============================================

-- Migrate users from vehicle_reminders (deduplicated by email)
INSERT INTO users (email, phone, notification_preferences, created_at, updated_at)
SELECT DISTINCT ON (email)
  email,
  phone,
  COALESCE(notification_preferences, '{"sms": false, "email": true, "voice": false, "reminder_days": [30, 14, 7, 3, 1, 0]}'::jsonb),
  created_at,
  COALESCE(updated_at, created_at)
FROM vehicle_reminders
WHERE email IS NOT NULL
ORDER BY email, created_at DESC;

-- Migrate vehicles from vehicle_reminders
INSERT INTO vehicles (user_id, license_plate, vin, zip_code, mailing_address, mailing_city, mailing_state, mailing_zip, subscription_id, subscription_status, created_at, updated_at)
SELECT DISTINCT ON (u.id, vr.license_plate)
  u.id as user_id,
  vr.license_plate,
  vr.vin,
  vr.zip_code,
  vr.mailing_address,
  vr.mailing_city,
  vr.mailing_state,
  vr.mailing_zip,
  vr.subscription_id,
  COALESCE(vr.subscription_status, 'active'),
  vr.created_at,
  COALESCE(vr.updated_at, vr.created_at)
FROM vehicle_reminders vr
JOIN users u ON u.email = vr.email
WHERE vr.license_plate IS NOT NULL
ORDER BY u.id, vr.license_plate, vr.created_at DESC;

-- Migrate city sticker obligations using CASE statement to avoid casting errors
INSERT INTO obligations (vehicle_id, user_id, type, due_date, completed, created_at)
SELECT DISTINCT ON (v.id, 'city_sticker', 
  CASE 
    WHEN vr.city_sticker_expiry IS NOT NULL 
     AND vr.city_sticker_expiry != '' 
     AND LENGTH(vr.city_sticker_expiry) = 10
     AND vr.city_sticker_expiry ~ '^\d{4}-\d{2}-\d{2}$'
    THEN vr.city_sticker_expiry::date
    ELSE NULL
  END
)
  v.id as vehicle_id,
  v.user_id,
  'city_sticker' as type,
  CASE 
    WHEN vr.city_sticker_expiry IS NOT NULL 
     AND vr.city_sticker_expiry != '' 
     AND LENGTH(vr.city_sticker_expiry) = 10
     AND vr.city_sticker_expiry ~ '^\d{4}-\d{2}-\d{2}$'
    THEN vr.city_sticker_expiry::date
    ELSE NULL
  END as due_date,
  COALESCE(vr.city_sticker_completed, false) as completed,
  vr.created_at
FROM vehicle_reminders vr
JOIN vehicles v ON v.license_plate = vr.license_plate
JOIN users u ON u.email = vr.email AND v.user_id = u.id
WHERE vr.city_sticker_expiry IS NOT NULL 
  AND vr.city_sticker_expiry != '' 
  AND LENGTH(vr.city_sticker_expiry) = 10
  AND vr.city_sticker_expiry ~ '^\d{4}-\d{2}-\d{2}$'
ORDER BY v.id, CASE 
  WHEN vr.city_sticker_expiry IS NOT NULL 
   AND vr.city_sticker_expiry != '' 
   AND LENGTH(vr.city_sticker_expiry) = 10
   AND vr.city_sticker_expiry ~ '^\d{4}-\d{2}-\d{2}$'
  THEN vr.city_sticker_expiry::date
  ELSE NULL
END, vr.created_at DESC;

-- Migrate license plate obligations using CASE statement to avoid casting errors
INSERT INTO obligations (vehicle_id, user_id, type, due_date, completed, created_at)
SELECT DISTINCT ON (v.id, 'license_plate',
  CASE 
    WHEN vr.license_plate_expiry IS NOT NULL 
     AND vr.license_plate_expiry != '' 
     AND LENGTH(vr.license_plate_expiry) = 10
     AND vr.license_plate_expiry ~ '^\d{4}-\d{2}-\d{2}$'
    THEN vr.license_plate_expiry::date
    ELSE NULL
  END
)
  v.id as vehicle_id,
  v.user_id,
  'license_plate' as type,
  CASE 
    WHEN vr.license_plate_expiry IS NOT NULL 
     AND vr.license_plate_expiry != '' 
     AND LENGTH(vr.license_plate_expiry) = 10
     AND vr.license_plate_expiry ~ '^\d{4}-\d{2}-\d{2}$'
    THEN vr.license_plate_expiry::date
    ELSE NULL
  END as due_date,
  COALESCE(vr.completed, false) as completed,
  vr.created_at
FROM vehicle_reminders vr
JOIN vehicles v ON v.license_plate = vr.license_plate
JOIN users u ON u.email = vr.email AND v.user_id = u.id
WHERE vr.license_plate_expiry IS NOT NULL 
  AND vr.license_plate_expiry != '' 
  AND LENGTH(vr.license_plate_expiry) = 10
  AND vr.license_plate_expiry ~ '^\d{4}-\d{2}-\d{2}$'
ORDER BY v.id, CASE 
  WHEN vr.license_plate_expiry IS NOT NULL 
   AND vr.license_plate_expiry != '' 
   AND LENGTH(vr.license_plate_expiry) = 10
   AND vr.license_plate_expiry ~ '^\d{4}-\d{2}-\d{2}$'
  THEN vr.license_plate_expiry::date
  ELSE NULL
END, vr.created_at DESC;

-- Migrate emissions obligations using CASE statement to avoid casting errors
INSERT INTO obligations (vehicle_id, user_id, type, due_date, completed, created_at)
SELECT DISTINCT ON (v.id, 'emissions',
  CASE 
    WHEN vr.emissions_due_date IS NOT NULL 
     AND vr.emissions_due_date != '' 
     AND LENGTH(vr.emissions_due_date) = 10
     AND vr.emissions_due_date ~ '^\d{4}-\d{2}-\d{2}$'
    THEN vr.emissions_due_date::date
    ELSE NULL
  END
)
  v.id as vehicle_id,
  v.user_id,
  'emissions' as type,
  CASE 
    WHEN vr.emissions_due_date IS NOT NULL 
     AND vr.emissions_due_date != '' 
     AND LENGTH(vr.emissions_due_date) = 10
     AND vr.emissions_due_date ~ '^\d{4}-\d{2}-\d{2}$'
    THEN vr.emissions_due_date::date
    ELSE NULL
  END as due_date,
  COALESCE(vr.emissions_completed, false) as completed,
  vr.created_at
FROM vehicle_reminders vr
JOIN vehicles v ON v.license_plate = vr.license_plate
JOIN users u ON u.email = vr.email AND v.user_id = u.id
WHERE vr.emissions_due_date IS NOT NULL 
  AND vr.emissions_due_date != '' 
  AND LENGTH(vr.emissions_due_date) = 10
  AND vr.emissions_due_date ~ '^\d{4}-\d{2}-\d{2}$'
ORDER BY v.id, CASE 
  WHEN vr.emissions_due_date IS NOT NULL 
   AND vr.emissions_due_date != '' 
   AND LENGTH(vr.emissions_due_date) = 10
   AND vr.emissions_due_date ~ '^\d{4}-\d{2}-\d{2}$'
  THEN vr.emissions_due_date::date
  ELSE NULL
END, vr.created_at DESC;

-- ============================================
-- STEP 4: CREATE INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_obligations_due_date ON obligations(due_date);
CREATE INDEX idx_obligations_user_id ON obligations(user_id);
CREATE INDEX idx_obligations_vehicle_id ON obligations(vehicle_id);
CREATE INDEX idx_obligations_type ON obligations(type);
CREATE INDEX idx_obligations_completed ON obligations(completed);
CREATE INDEX idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX idx_reminders_obligation_id ON reminders(obligation_id);
CREATE INDEX idx_reminders_sent_at ON reminders(sent_at);

-- ============================================
-- STEP 5: CREATE VIEWS FOR EASY QUERIES
-- ============================================

-- View for upcoming obligations with user/vehicle info
CREATE VIEW upcoming_obligations AS
SELECT 
  o.*,
  v.license_plate,
  v.vin,
  u.email,
  u.phone,
  u.notification_preferences,
  EXTRACT(DAY FROM o.due_date - CURRENT_DATE)::integer as days_until_due
FROM obligations o
JOIN vehicles v ON o.vehicle_id = v.id
JOIN users u ON o.user_id = u.id
WHERE o.completed = false
  AND o.due_date >= CURRENT_DATE
ORDER BY o.due_date;

-- View for overdue obligations
CREATE VIEW overdue_obligations AS
SELECT 
  o.*,
  v.license_plate,
  u.email,
  u.phone,
  ABS(EXTRACT(DAY FROM o.due_date - CURRENT_DATE))::integer as days_overdue
FROM obligations o
JOIN vehicles v ON o.vehicle_id = v.id
JOIN users u ON o.user_id = u.id
WHERE o.completed = false
  AND o.due_date < CURRENT_DATE
ORDER BY o.due_date;

-- ============================================
-- STEP 6: CREATE FUNCTIONS FOR NOTIFICATIONS
-- ============================================

-- Function to get obligations needing reminders
CREATE FUNCTION get_obligations_needing_reminders(days_ahead INTEGER)
RETURNS TABLE (
  obligation_id UUID,
  user_id UUID,
  vehicle_id UUID,
  type VARCHAR,
  due_date DATE,
  email VARCHAR,
  phone VARCHAR,
  license_plate VARCHAR,
  notification_preferences JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id as obligation_id,
    o.user_id,
    o.vehicle_id,
    o.type,
    o.due_date,
    u.email,
    u.phone,
    v.license_plate,
    u.notification_preferences
  FROM obligations o
  JOIN vehicles v ON o.vehicle_id = v.id
  JOIN users u ON o.user_id = u.id
  WHERE o.completed = false
    AND o.due_date = CURRENT_DATE + INTERVAL '1 day' * days_ahead
    AND NOT EXISTS (
      SELECT 1 FROM reminders r 
      WHERE r.obligation_id = o.id 
        AND r.days_until_due = days_ahead
        AND r.sent_at::date = CURRENT_DATE
    );
END;
$$ LANGUAGE plpgsql;

-- Function to log a sent reminder
CREATE FUNCTION log_reminder(
  p_obligation_id UUID,
  p_user_id UUID,
  p_method VARCHAR,
  p_days_until_due INTEGER,
  p_status VARCHAR DEFAULT 'sent',
  p_error_message TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
  reminder_id UUID;
BEGIN
  INSERT INTO reminders (obligation_id, user_id, method, days_until_due, status, error_message)
  VALUES (p_obligation_id, p_user_id, p_method, p_days_until_due, p_status, p_error_message)
  RETURNING id INTO reminder_id;
  
  RETURN reminder_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- STEP 7: ENABLE RLS (SIMPLIFIED FOR NOW)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Service role can see everything (simplified for now)
CREATE POLICY users_policy ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY vehicles_policy ON vehicles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY obligations_policy ON obligations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY reminders_policy ON reminders FOR ALL USING (true) WITH CHECK (true);

-- ============================================
-- VERIFICATION QUERIES
-- ============================================

-- Check migrated data counts
SELECT 'Users' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'Vehicles', COUNT(*) FROM vehicles
UNION ALL
SELECT 'Obligations', COUNT(*) FROM obligations
UNION ALL
SELECT 'City Sticker Obligations', COUNT(*) FROM obligations WHERE type = 'city_sticker'
UNION ALL
SELECT 'License Plate Obligations', COUNT(*) FROM obligations WHERE type = 'license_plate'
UNION ALL
SELECT 'Emissions Obligations', COUNT(*) FROM obligations WHERE type = 'emissions';

-- Check upcoming obligations with details
SELECT 
  type,
  due_date,
  days_until_due,
  email,
  license_plate
FROM upcoming_obligations 
ORDER BY days_until_due;

-- Test the reminder function for today (0 days ahead)
SELECT 'Reminders for today:' as info;
SELECT * FROM get_obligations_needing_reminders(0);

-- Test for tomorrow (1 day ahead)  
SELECT 'Reminders for tomorrow:' as info;
SELECT * FROM get_obligations_needing_reminders(1);