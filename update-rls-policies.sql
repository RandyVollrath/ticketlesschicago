-- Update RLS policies to allow authenticated users to access their own data

-- Drop existing overly permissive policies
DROP POLICY IF EXISTS users_policy ON users;
DROP POLICY IF EXISTS vehicles_policy ON vehicles;
DROP POLICY IF EXISTS obligations_policy ON obligations;
DROP POLICY IF EXISTS reminders_policy ON reminders;

-- Users can view and update their own profile
CREATE POLICY users_policy ON users 
FOR ALL USING (
  auth.uid()::text = id::text OR 
  auth.role() = 'service_role'
) 
WITH CHECK (
  auth.uid()::text = id::text OR 
  auth.role() = 'service_role'
);

-- Users can view their own vehicles
CREATE POLICY vehicles_policy ON vehicles 
FOR ALL USING (
  auth.uid()::text = user_id::text OR 
  auth.role() = 'service_role'
) 
WITH CHECK (
  auth.uid()::text = user_id::text OR 
  auth.role() = 'service_role'
);

-- Users can view their own obligations
CREATE POLICY obligations_policy ON obligations 
FOR ALL USING (
  auth.uid()::text = user_id::text OR 
  auth.role() = 'service_role'
) 
WITH CHECK (
  auth.uid()::text = user_id::text OR 
  auth.role() = 'service_role'
);

-- Users can view their own reminders
CREATE POLICY reminders_policy ON reminders 
FOR ALL USING (
  auth.uid()::text = user_id::text OR 
  auth.role() = 'service_role'
) 
WITH CHECK (
  auth.uid()::text = user_id::text OR 
  auth.role() = 'service_role'
);

-- Allow authenticated users to read from the upcoming_obligations view
-- Note: Views inherit policies from underlying tables, so this should work automatically

-- Also update the function to handle user_id matching
CREATE OR REPLACE FUNCTION get_user_obligations(user_uuid UUID)
RETURNS TABLE (
  obligation_id UUID,
  user_id UUID,
  vehicle_id UUID,
  type VARCHAR,
  due_date DATE,
  email VARCHAR,
  phone VARCHAR,
  license_plate VARCHAR,
  notification_preferences JSONB,
  days_until_due INTEGER
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
    u.notification_preferences,
    (o.due_date - CURRENT_DATE)::integer as days_until_due
  FROM obligations o
  JOIN vehicles v ON o.vehicle_id = v.id
  JOIN users u ON o.user_id = u.id
  WHERE o.completed = false
    AND o.user_id = user_uuid
    AND o.due_date >= CURRENT_DATE
  ORDER BY o.due_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verification query
SELECT 'RLS Policies Updated Successfully' as status;