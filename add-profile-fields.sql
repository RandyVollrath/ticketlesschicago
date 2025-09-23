-- Add missing profile fields to users table
-- This ensures all fields from the settings form can be saved to the database

-- Add vehicle information fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_plate VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vin VARCHAR(17);
ALTER TABLE users ADD COLUMN IF NOT EXISTS zip_code VARCHAR(10);
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(30) DEFAULT 'passenger';
ALTER TABLE users ADD COLUMN IF NOT EXISTS vehicle_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE);

-- Add renewal date fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS city_sticker_expiry DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS license_plate_expiry DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS emissions_date DATE;

-- Add address fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS street_address VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS street_side VARCHAR(10) DEFAULT 'even';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mailing_address VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mailing_city VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mailing_state VARCHAR(2) DEFAULT 'IL';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mailing_zip VARCHAR(10);

-- Add concierge service fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS concierge_service BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS city_stickers_only BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS spending_limit INTEGER DEFAULT 500;

-- Add subscription status field if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'active';

-- Update the updated_at timestamp for any changes
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Verify the table structure
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'users' 
ORDER BY ordinal_position;