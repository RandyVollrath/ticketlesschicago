-- DATABASE MIGRATION SCRIPT (FIXED)
-- Clean database structure for Ticketless Chicago
-- Run this in Supabase SQL Editor

-- ============================================
-- STEP 0: DROP OLD TABLES IF DOING CLEAN MIGRATION
-- ============================================
-- Uncomment these if you want to start completely fresh:
-- DROP TABLE IF EXISTS reminders CASCADE;
-- DROP TABLE IF EXISTS obligations CASCADE;
-- DROP TABLE IF EXISTS vehicles CASCADE;
-- DROP TABLE IF EXISTS users CASCADE;

-- ============================================
-- STEP 1: CREATE NEW TABLES
-- ============================================

-- Users: Core user data
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  notification_preferences JSONB DEFAULT '{"sms": false, "email": true, "voice": false, "reminder_days": [30, 14, 7, 3, 1, 0]}'::jsonb
);

-- Add unique constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'users_email_key'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
  END IF;
END $$;

-- Vehicles: User-owned vehicles  
CREATE TABLE IF NOT EXISTS vehicles (
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
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'vehicles_user_license_key'
  ) THEN
    ALTER TABLE vehicles ADD CONSTRAINT vehicles_user_license_key UNIQUE (user_id, license_plate);
  END IF;
END $$;

-- Obligations: All compliance deadlines
CREATE TABLE IF NOT EXISTS obligations (
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
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'obligations_vehicle_type_date_key'
  ) THEN
    ALTER TABLE obligations ADD CONSTRAINT obligations_vehicle_type_date_key UNIQUE (vehicle_id, type, due_date);
  END IF;
END $$;

-- Reminders: Log of sent reminders
CREATE TABLE IF NOT EXISTS reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obligation_id UUID REFERENCES obligations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  method VARCHAR(20) NOT NULL, -- 'email', 'sms', 'voice'
  days_until_due INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'sent', -- 'sent', 'failed', 'bounced'
  error_message TEXT
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_obligations_due_date ON obligations(due_date);
CREATE INDEX IF NOT EXISTS idx_obligations_user_id ON obligations(user_id);
CREATE INDEX IF NOT EXISTS idx_obligations_vehicle_id ON obligations(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_obligations_type ON obligations(type);
CREATE INDEX IF NOT EXISTS idx_vehicles_user_id ON vehicles(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_obligation_id ON reminders(obligation_id);
CREATE INDEX IF NOT EXISTS idx_reminders_sent_at ON reminders(sent_at);

-- ============================================
-- STEP 2: MIGRATE EXISTING DATA
-- ============================================

-- First, let's check if we have data to migrate
DO $$
DECLARE
  has_data BOOLEAN;
BEGIN
  -- Check if vehicle_reminders table exists and has data
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_name = 'vehicle_reminders'
  ) INTO has_data;
  
  IF has_data THEN
    -- Migrate users from vehicle_reminders (deduplicated by email)
    INSERT INTO users (id, email, phone, notification_preferences, created_at, updated_at)
    SELECT DISTINCT ON (email)
      COALESCE(user_id::uuid, gen_random_uuid()) as id,
      email,
      phone,
      COALESCE(notification_preferences, '{"sms": false, "email": true, "voice": false, "reminder_days": [30, 14, 7, 3, 1, 0]}'::jsonb),
      created_at,
      updated_at
    FROM vehicle_reminders
    WHERE email IS NOT NULL
    ON CONFLICT (email) DO UPDATE SET
      phone = COALESCE(EXCLUDED.phone, users.phone),
      notification_preferences = COALESCE(EXCLUDED.notification_preferences, users.notification_preferences),
      updated_at = EXCLUDED.updated_at;

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
      vr.subscription_status,
      vr.created_at,
      vr.updated_at
    FROM vehicle_reminders vr
    JOIN users u ON u.email = vr.email
    WHERE vr.license_plate IS NOT NULL
    ON CONFLICT (user_id, license_plate) DO UPDATE SET
      subscription_status = COALESCE(EXCLUDED.subscription_status, vehicles.subscription_status),
      updated_at = EXCLUDED.updated_at;

    -- Migrate city sticker obligations
    INSERT INTO obligations (vehicle_id, user_id, type, due_date, completed, created_at)
    SELECT DISTINCT ON (v.id, 'city_sticker', vr.city_sticker_expiry::date)
      v.id as vehicle_id,
      v.user_id,
      'city_sticker' as type,
      vr.city_sticker_expiry::date as due_date,
      COALESCE(vr.city_sticker_completed, false) as completed,
      vr.created_at
    FROM vehicle_reminders vr
    JOIN vehicles v ON v.license_plate = vr.license_plate
    JOIN users u ON u.email = vr.email AND v.user_id = u.id
    WHERE vr.city_sticker_expiry IS NOT NULL
    ON CONFLICT (vehicle_id, type, due_date) DO NOTHING;

    -- Migrate license plate obligations
    INSERT INTO obligations (vehicle_id, user_id, type, due_date, completed, created_at)
    SELECT DISTINCT ON (v.id, 'license_plate', vr.license_plate_expiry::date)
      v.id as vehicle_id,
      v.user_id,
      'license_plate' as type,
      vr.license_plate_expiry::date as due_date,
      COALESCE(vr.completed, false) as completed,
      vr.created_at
    FROM vehicle_reminders vr
    JOIN vehicles v ON v.license_plate = vr.license_plate
    JOIN users u ON u.email = vr.email AND v.user_id = u.id
    WHERE vr.license_plate_expiry IS NOT NULL
    ON CONFLICT (vehicle_id, type, due_date) DO NOTHING;

    -- Migrate emissions obligations
    INSERT INTO obligations (vehicle_id, user_id, type, due_date, completed, created_at)
    SELECT DISTINCT ON (v.id, 'emissions', vr.emissions_due_date::date)
      v.id as vehicle_id,
      v.user_id,
      'emissions' as type,
      vr.emissions_due_date::date as due_date,
      COALESCE(vr.emissions_completed, false) as completed,
      vr.created_at
    FROM vehicle_reminders vr
    JOIN vehicles v ON v.license_plate = vr.license_plate
    JOIN users u ON u.email = vr.email AND v.user_id = u.id
    WHERE vr.emissions_due_date IS NOT NULL
    ON CONFLICT (vehicle_id, type, due_date) DO NOTHING;
    
    RAISE NOTICE 'Migration completed successfully';
  ELSE
    RAISE NOTICE 'No existing data to migrate - starting fresh';
  END IF;
END $$;

-- ============================================
-- STEP 3: CREATE VIEWS FOR EASY QUERIES
-- ============================================

-- Drop views if they exist
DROP VIEW IF EXISTS upcoming_obligations CASCADE;
DROP VIEW IF EXISTS overdue_obligations CASCADE;

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
-- STEP 4: CREATE FUNCTIONS FOR NOTIFICATIONS
-- ============================================

-- Drop functions if they exist
DROP FUNCTION IF EXISTS get_obligations_needing_reminders(INTEGER);
DROP FUNCTION IF EXISTS log_reminder(UUID, UUID, VARCHAR, INTEGER, VARCHAR, TEXT);

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
-- STEP 5: ADD RLS POLICIES (OPTIONAL)
-- ============================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS users_policy ON users;
DROP POLICY IF EXISTS vehicles_policy ON vehicles;
DROP POLICY IF EXISTS obligations_policy ON obligations;
DROP POLICY IF EXISTS reminders_policy ON reminders;

-- Service role can see everything
CREATE POLICY users_policy ON users
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY vehicles_policy ON vehicles
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY obligations_policy ON obligations
  FOR ALL USING (true)
  WITH CHECK (true);

CREATE POLICY reminders_policy ON reminders
  FOR ALL USING (true)
  WITH CHECK (true);

-- ============================================
-- VERIFICATION QUERIES (Run these to check)
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

-- Check upcoming obligations
SELECT * FROM upcoming_obligations LIMIT 10;

-- Check if we have any obligations due soon
SELECT 
  type,
  due_date,
  days_until_due,
  email,
  license_plate
FROM upcoming_obligations 
WHERE days_until_due <= 7
ORDER BY days_until_due;

-- Test the reminder function for tomorrow
SELECT * FROM get_obligations_needing_reminders(1);