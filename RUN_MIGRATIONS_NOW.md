# 🚀 Run These Migrations NOW

## Quick Start: Copy-Paste into Supabase SQL Editor

### Step 1: Go to Supabase Dashboard
1. Open https://supabase.com/dashboard
2. Select your project: `ticketless-chicago`
3. Click **SQL Editor** in the left sidebar
4. Click **New Query**

---

## Migration 1: Email Forwarding Support

**Copy this entire block and paste into Supabase SQL Editor:**

```sql
-- Add email forwarding for proof of residency via utility bills
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email_forwarding_address TEXT,
ADD COLUMN IF NOT EXISTS residency_proof_path TEXT,
ADD COLUMN IF NOT EXISTS residency_proof_uploaded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS residency_proof_verified BOOLEAN,
ADD COLUMN IF NOT EXISTS residency_proof_verified_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS residency_forwarding_enabled BOOLEAN,
ADD COLUMN IF NOT EXISTS residency_forwarding_consent_given BOOLEAN,
ADD COLUMN IF NOT EXISTS residency_forwarding_consent_given_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS city_sticker_purchase_confirmed_at TIMESTAMPTZ;

-- Set defaults
ALTER TABLE user_profiles
ALTER COLUMN residency_proof_verified SET DEFAULT false,
ALTER COLUMN residency_forwarding_enabled SET DEFAULT false,
ALTER COLUMN residency_forwarding_consent_given SET DEFAULT false;

-- Update existing rows
UPDATE user_profiles
SET residency_proof_verified = false
WHERE residency_proof_verified IS NULL;

UPDATE user_profiles
SET residency_forwarding_enabled = false
WHERE residency_forwarding_enabled IS NULL;

UPDATE user_profiles
SET residency_forwarding_consent_given = false
WHERE residency_forwarding_consent_given IS NULL;

-- Function to generate email forwarding address
CREATE OR REPLACE FUNCTION generate_email_forwarding_address()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.has_protection = true
     AND NEW.email_forwarding_address IS NULL
  THEN
    NEW.email_forwarding_address := 'documents+' || NEW.user_id || '@autopilotamerica.com';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate email forwarding address
DROP TRIGGER IF EXISTS set_email_forwarding_address ON user_profiles;

CREATE TRIGGER set_email_forwarding_address
  BEFORE INSERT OR UPDATE OF has_protection ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION generate_email_forwarding_address();

-- Indexes
DROP INDEX IF EXISTS idx_residency_proof_cleanup;
CREATE INDEX idx_residency_proof_cleanup
ON user_profiles(residency_proof_uploaded_at)
WHERE residency_proof_path IS NOT NULL;

DROP INDEX IF EXISTS idx_city_sticker_purchase_confirmed;
CREATE INDEX idx_city_sticker_purchase_confirmed
ON user_profiles(city_sticker_purchase_confirmed_at)
WHERE city_sticker_purchase_confirmed_at IS NOT NULL;
```

**Click "RUN" button in Supabase**

**Expected output:** Success message

---

## Migration 2: License Plate Renewal Support

**Copy this entire block and paste into a NEW query:**

```sql
-- Add license plate renewal fields
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS license_plate_renewal_cost DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS license_plate_type TEXT,
ADD COLUMN IF NOT EXISTS license_plate_is_personalized BOOLEAN,
ADD COLUMN IF NOT EXISTS license_plate_is_vanity BOOLEAN,
ADD COLUMN IF NOT EXISTS license_plate_last_accessed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS trailer_weight INTEGER,
ADD COLUMN IF NOT EXISTS rv_weight INTEGER;

-- Set defaults
ALTER TABLE user_profiles
ALTER COLUMN license_plate_is_personalized SET DEFAULT false,
ALTER COLUMN license_plate_is_vanity SET DEFAULT false;

-- Update existing rows
UPDATE user_profiles
SET license_plate_is_personalized = false
WHERE license_plate_is_personalized IS NULL;

UPDATE user_profiles
SET license_plate_is_vanity = false
WHERE license_plate_is_vanity IS NULL;

-- Function to calculate Illinois license plate renewal cost
CREATE OR REPLACE FUNCTION calculate_plate_renewal_cost(
  plate_type TEXT,
  is_personalized BOOLEAN DEFAULT false,
  is_vanity BOOLEAN DEFAULT false,
  trailer_weight_lbs INTEGER DEFAULT NULL,
  rv_weight_lbs INTEGER DEFAULT NULL
) RETURNS DECIMAL(10,2) AS $$
DECLARE
  base_cost DECIMAL(10,2);
BEGIN
  CASE UPPER(plate_type)
    WHEN 'PASSENGER' THEN base_cost := 151.00;
    WHEN 'MOTORCYCLE' THEN base_cost := 41.00;
    WHEN 'B-TRUCK' THEN base_cost := 151.00;
    WHEN 'C-TRUCK' THEN base_cost := 218.00;
    WHEN 'PERSONS_WITH_DISABILITIES' THEN base_cost := 151.00;
    WHEN 'RT' THEN
      IF trailer_weight_lbs IS NULL THEN
        base_cost := 18.00;
      ELSIF trailer_weight_lbs <= 3000 THEN
        base_cost := 18.00;
      ELSIF trailer_weight_lbs <= 8000 THEN
        base_cost := 30.00;
      ELSIF trailer_weight_lbs <= 10000 THEN
        base_cost := 38.00;
      ELSE
        base_cost := 50.00;
      END IF;
    WHEN 'RV' THEN
      IF rv_weight_lbs IS NULL THEN
        base_cost := 78.00;
      ELSIF rv_weight_lbs <= 8000 THEN
        base_cost := 78.00;
      ELSIF rv_weight_lbs <= 10000 THEN
        base_cost := 90.00;
      ELSE
        base_cost := 102.00;
      END IF;
    ELSE
      base_cost := 151.00;
  END CASE;

  IF is_personalized THEN
    base_cost := base_cost + 7.00;
  END IF;

  IF is_vanity THEN
    base_cost := base_cost + 13.00;
  END IF;

  RETURN base_cost;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-calculate renewal cost
CREATE OR REPLACE FUNCTION update_plate_renewal_cost()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.license_plate_type IS NOT NULL THEN
    NEW.license_plate_renewal_cost := calculate_plate_renewal_cost(
      NEW.license_plate_type,
      COALESCE(NEW.license_plate_is_personalized, false),
      COALESCE(NEW.license_plate_is_vanity, false),
      NEW.trailer_weight,
      NEW.rv_weight
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS calculate_plate_cost ON user_profiles;

CREATE TRIGGER calculate_plate_cost
  BEFORE INSERT OR UPDATE OF license_plate_type, license_plate_is_personalized,
                             license_plate_is_vanity, trailer_weight, rv_weight
  ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_plate_renewal_cost();

-- Index
CREATE INDEX IF NOT EXISTS idx_license_plate_last_accessed
ON user_profiles(license_plate_last_accessed_at)
WHERE license_plate_last_accessed_at IS NOT NULL;
```

**Click "RUN" button in Supabase**

**Expected output:** Success message

---

## Verification Query

**After running both migrations, run this to verify:**

```sql
-- Check columns exist
SELECT
  column_name,
  data_type
FROM information_schema.columns
WHERE table_name = 'user_profiles'
AND column_name IN (
  'email_forwarding_address',
  'residency_proof_path',
  'license_plate_type',
  'license_plate_renewal_cost'
)
ORDER BY column_name;
```

**Expected:** Should return 4 rows showing all columns exist

---

## Test the Functions

**Test license plate cost calculation:**

```sql
-- Test passenger car
SELECT calculate_plate_renewal_cost('PASSENGER', false, false, NULL, NULL) as passenger_cost;
-- Expected: $151.00

-- Test personalized passenger
SELECT calculate_plate_renewal_cost('PASSENGER', true, false, NULL, NULL) as personalized_cost;
-- Expected: $158.00

-- Test motorcycle
SELECT calculate_plate_renewal_cost('MOTORCYCLE', false, false, NULL, NULL) as motorcycle_cost;
-- Expected: $41.00

-- Test RV
SELECT calculate_plate_renewal_cost('RV', false, false, NULL, 9000) as rv_cost;
-- Expected: $90.00
```

**Expected:** All calculations should match the expected values

---

## ✅ Success Checklist

After running the migrations:

- [  ] Migration 1 ran without errors
- [  ] Migration 2 ran without errors
- [  ] Verification query returned 4 rows
- [  ] Test functions returned correct values
- [  ] No error messages in Supabase

---

## 🆘 If Something Fails

**Error: "column already exists"**
- ✅ This is GOOD! It means the column was already added
- Continue to the next statement

**Error: "permission denied"**
- Check you're using the service role key
- Make sure you're logged into the correct Supabase project

**Error: "relation does not exist"**
- Check `user_profiles` table exists
- You may be in the wrong database

---

## After Migrations Complete

Come back and tell me:
1. Did both migrations run successfully?
2. Did verification query return 4 rows?
3. Any errors encountered?

Then we'll move on to creating the verification script!
