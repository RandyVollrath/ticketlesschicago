# Complete is_paid Code Locations Report

## Summary
Found all code paths that set `is_paid` to `true` in the codebase. The `is_paid` column in the `user_profiles` table is used to mark users as paid subscribers. Here are ALL locations where `is_paid` is set:

---

## 1. Database Migrations & Schema

### Location: `/home/randy-vollrath/ticketless-chicago/supabase/migrations/fix_oauth_user_creation.sql`
**Line 14** - Sets DEFAULT value for all new profiles
```sql
ALTER TABLE user_profiles ALTER COLUMN is_paid SET DEFAULT false;
```
**Impact**: New user profiles created via OAuth get `is_paid = false` by default

---

### Location: `/home/randy-vollrath/ticketless-chicago/consolidate-to-user-profiles-migration.sql`
**Line 390** - Trigger function sets is_paid on INSERT
```plpgsql
NEW.is_paid := COALESCE(NEW.is_paid, true); -- All Ticketless America users are paid
```
**Context** (Lines 383-396):
```plpgsql
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS trigger AS $$
BEGIN
    -- Set default values for new users
    NEW.id := COALESCE(NEW.id, gen_random_uuid());
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    NEW.is_paid := COALESCE(NEW.is_paid, true); -- All Ticketless America users are paid
    NEW.sms_pro := COALESCE(NEW.sms_pro, true); -- All Ticketless America users are pro
    NEW.subscription_status := COALESCE(NEW.subscription_status, 'active');
    NEW.role := COALESCE(NEW.role, 'user');
    
    RETURN NEW;
END;
```
**Impact**: Trigger fires BEFORE INSERT on user_profiles table - defaults to true for all Ticketless users

---

### Location: `/home/randy-vollrath/ticketless-chicago/add-street-cleaning-migration-correct.sql`
**Line 100** - Column definition with DEFAULT value
```sql
is_paid boolean DEFAULT true, -- All Ticketless America users are paid
```
**Context** (Lines 88-136): CREATE TABLE statement for user_profiles

---

## 2. API Routes Setting is_paid = true

### Location: `/home/randy-vollrath/ticketless-chicago/pages/api/alerts/create.ts`
**Line 213** - Free alerts signup
```typescript
is_paid: true, // Free users are considered "paid" for alerts
```
**Full context** (Lines 195-217):
```typescript
const profileData = {
  user_id: userId,
  email,
  phone_number: normalizedPhone,
  first_name: firstName,
  last_name: lastName,
  zip_code: zip,
  license_plate: licensePlate.toUpperCase(),
  home_address_full: address,
  city: city || 'chicago',
  timezone: cityConfig.timezone,
  // Auto-populate mailing address from home address
  mailing_address: address,
  mailing_city: cityConfig.mailingCity,
  mailing_state: cityConfig.mailingState,
  mailing_zip: zip,
  notify_email: true,
  notify_sms: smsConsent === true, // TCPA compliance - only enable if user consented
  is_paid: true, // Free users are considered "paid" for alerts
  has_contesting: false,
  marketing_consent: marketingConsent === true, // CAN-SPAM compliance
  updated_at: new Date().toISOString()
};
```
**Impact**: All free alert signups are marked as "paid" users

---

### Location: `/home/randy-vollrath/ticketless-chicago/pages/api/stripe-webhook.ts`
**Two locations in Stripe webhook handler:**

#### Location A: Line 2099 - New user profile creation
```typescript
is_paid: true,
```
**Full context** (Lines 2050-2104):
```typescript
const userProfileData = {
  user_id: authData.user.id,
  email: email,
  phone_number: normalizePhoneNumber(formData.phone),
  license_plate: formData.licensePlate || null,
  home_address_full: formData.homeAddress || null,
  home_address_ward: formData.homeAddressWard || null,
  home_address_section: formData.homeAddressSection || null,
  // Map form notification preferences to Ticketless fields
  notify_email: formData.emailNotifications !== false,
  notify_sms: formData.smsNotifications || false,
  notify_snow: false,
  notify_winter_parking: false,
  phone_call_enabled: formData.voiceNotifications || false,
  voice_calls_enabled: formData.voiceNotifications || false,
  notify_days_array: formData.reminderDays || [1, 7, 30],
  notify_days_before: formData.reminderDays?.[0] || 1,
  notify_evening_before: formData.eveningBefore !== false,
  voice_preference: 'female',
  phone_call_time_preference: '7am',
  voice_call_time: '07:00',
  follow_up_sms: formData.followUpSms !== false,
  notification_preferences: {
    email: formData.emailNotifications !== false,
    sms: formData.smsNotifications || false,
    voice: formData.voiceNotifications || false,
    reminder_days: formData.reminderDays || [1, 7, 30]
  },
  // All Ticketless users are paid
  sms_pro: true,
  is_paid: true,
  is_canary: false,
  role: 'user',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
};
```
**Impact**: New users created via Stripe webhook are marked as paid

#### Location B: Line 2250 - Existing user profile update
```typescript
is_paid: true,
```
**Full context** (Lines 2238-2252):
```typescript
// Update user_profiles with form data for existing user
const userProfileUpdateData = {
  phone_number: normalizePhoneNumber(formData.phone),
  license_plate: formData.licensePlate || null,
  // Use new firstName/lastName fields from form
  first_name: formData.firstName || null,
  last_name: formData.lastName || null,
  notify_email: formData.emailNotifications !== false,
  notify_sms: formData.smsNotifications || false,
  phone_call_enabled: formData.voiceNotifications || false,
  notify_days_array: formData.reminderDays || [1],
  sms_pro: true,
  is_paid: true,
  updated_at: new Date().toISOString()
};
```
**Impact**: Existing users are updated to `is_paid = true` when Stripe webhook processes

---

## 3. Data Migration & Utility Scripts

### Location: `/home/randy-vollrath/ticketless-chicago/run-migration.js`
**Line 110** - Preserving existing is_paid value during migration
```javascript
is_paid: existingProfile?.is_paid,
```
**Impact**: During migration, existing is_paid values are preserved (not creating new true values)

---

### Location: `/home/randy-vollrath/ticketless-chicago/manual-randy-migration.js`
**Line 103** - Manual migration with fallback to true
```javascript
is_paid: existingProfile?.is_paid || true,
```
**Full context** (Lines 95-110):
```javascript
sms_pro: existingProfile?.sms_pro || true, // Ticketless users are pro
is_paid: existingProfile?.is_paid || true,
is_canary: existingProfile?.is_canary || false,

// Timestamps
created_at: existingProfile?.created_at || user.created_at,
updated_at: new Date().toISOString()
```
**Impact**: If migrating a user and no existing is_paid value, defaults to true

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/migrate-msc-to-aa.js`
**Context**: File includes is_paid in field list for migration
**Impact**: is_paid field is migrated during MyStreetCleaning to AutoPilot America migration

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/fix-hellodoll-user.js`
**Line 91** - Fix script for HelloDoll user
```javascript
is_paid: true,
```
**Full context** (Lines 86-94):
```javascript
const { error: profileError } = await supabase.from('user_profiles').insert({
  user_id: userId,
  email: metadata.email,
  phone_number: metadata.phone,
  zip_code: zipCode,
  mailing_zip: zipCode,
  street_address: metadata.streetAddress,
  home_address_full: metadata.streetAddress,
  has_permit_zone: metadata.hasPermitZone === 'true',
  permit_requested: metadata.permitRequested === 'true',
  is_paid: true,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
});
```
**Impact**: One-off user fix script sets is_paid = true

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/fix-mystreetcleaning-user.js`
**Line 36** - Fix script for MyStreetCleaning user
```javascript
is_paid: true,
```
**Full context** (Lines 31-42):
```javascript
const { error: updateError } = await supabase
  .from('user_profiles')
  .update({
    has_protection: true,
    stripe_customer_id: stripeCustomerId,
    is_paid: true,
    first_name: firstName,
    last_name: lastName,
    phone_number: metadata.phone,
    zip_code: zipCode,
    street_address: metadata.streetAddress,
```
**Impact**: Updates user to is_paid = true

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/test-msc-direct.js`
**Line 46** - TEST SCRIPT - Sets is_paid = false (test user)
```javascript
is_paid: false
```
**Full context** (Lines 36-49):
```javascript
const { data: profile, error: profileError } = await supabase
  .from('user_profiles')
  .insert({
    user_id: userId,
    email: metadata.email,
    phone_number: metadata.phone,
    first_name: firstName,
    last_name: lastName,
    notify_email: true,
    notify_sms: false,
    email_enabled: true,
    sms_enabled: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source: 'ticketlessamerica',
    is_paid: false
  })
```
**Impact**: This is a test script - intentionally creates unpaid user for testing

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/fix-hellodoll-profile.js`
**Line 52** - Fix script for HelloDoll profile
```javascript
is_paid: true,
```
**Full context** (Lines 37-56):
```javascript
const { error: profileError } = await supabase
  .from('user_profiles')
  .insert({
    user_id: userId,
    email: 'dolldarlings@hellodoll.com',
    phone_number: metadata.phone,
    zip_code: zipCode,
    mailing_zip: zipCode,
    street_address: metadata.streetAddress,
    home_address_full: metadata.streetAddress,
    first_name: 'Doll',
    last_name: 'Darlings',
    has_protection: true,
    notify_email: true,
    notify_sms: false,
    is_paid: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
```
**Impact**: One-off user fix script sets is_paid = true

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/fix-mystreetcleaning2.js`
**Line 36** - Fix script for MyStreetCleaning user (duplicate/fix)
```javascript
is_paid: true,
```
**Full context** (Lines 31-42):
```javascript
const { error: updateError } = await supabase
  .from('user_profiles')
  .update({
    has_protection: true,
    stripe_customer_id: stripeCustomerId,
    is_paid: true,
    first_name: firstName,
    last_name: lastName,
    phone_number: metadata.phone,
    zip_code: zipCode,
    street_address: metadata.streetAddress,
```
**Impact**: Updates user to is_paid = true

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/diagnose-webhook.js`
**Line 41** - Diagnostic script that queries is_paid field
```javascript
.select('has_protection, stripe_customer_id, is_paid, first_name, street_address')
```
**Impact**: Reads is_paid field for debugging (does not set it)

---

### Location: `/home/randy-vollrath/ticketless-chicago/scripts/consolidate-tables.js`
**Line 112** - Preserving existing is_paid during consolidation
```javascript
is_paid: existingProfile?.is_paid,
```
**Full context** (Lines 105-120):
```javascript
sms_pro: existingProfile?.sms_pro,
is_paid: existingProfile?.is_paid,
is_canary: existingProfile?.is_canary,
role: existingProfile?.role,

// Timestamps
created_at: existingProfile?.created_at || user.created_at,
updated_at: new Date().toISOString()
```
**Impact**: During table consolidation, existing is_paid values are preserved

---

## 4. TypeScript Types & Constants

### Location: `/home/randy-vollrath/ticketless-chicago/lib/database.types.ts`
**is_paid field definition**
```typescript
is_paid: boolean | null
is_paid?: boolean | null
is_paid?: boolean | null
```
**Impact**: Type definition - allows null or boolean

---

## 5. Test/Setup Data

### Location: `/home/randy-vollrath/ticketless-chicago/sql/setup-randy-profile.sql`
**Line 44** - Setup script for test user (Randy)
```sql
true, -- Paid user
```
**Full INSERT context** (Lines 7-49):
```sql
INSERT INTO user_profiles (
  email,
  phone_number,
  home_address_full,
  home_address_ward,
  home_address_section,
  notify_days_array,
  notify_evening_before,
  notify_email,
  notify_sms,
  notify_snow,
  notify_winter_parking,
  phone_call_enabled,
  voice_calls_enabled,
  follow_up_sms,
  sms_pro,
  is_paid,
  is_canary,
  role,
  created_at,
  updated_at
) VALUES (
  'randyvollrath@gmail.com',
  '+13125551234',
  '1013 W Webster Ave, Chicago, IL 60614',
  '43',
  '7',
  ARRAY[0, 1],
  true,
  true,
  true,
  false,
  false,
  false,
  false,
  true,
  true,
  true,  -- Paid user
  true,
  'user',
  NOW(),
  NOW()
)
```
**Impact**: Test profile setup for Randy with is_paid = true

---

## 6. Profile Update Endpoint

### Location: `/home/randy-vollrath/ticketless-chicago/pages/api/profile.ts`
**Line 117** - is_paid listed in allowedFields for updates
```typescript
'is_paid',
```
**Full context** (Lines 51-119):
```typescript
const allowedFields = [
  // Personal information
  'first_name',
  'last_name',
  'phone',
  'phone_number',
  'email_verified',
  'phone_verified',
  
  // Vehicle information
  'license_plate',
  'vin',
  'vehicle_type',
  'vehicle_year',
  'license_plate_street_cleaning',
  
  // ... more fields ...
  
  // Ticketless-specific fields
  'guarantee_opt_in_year',
  'is_paid',  // <-- Line 117
  'role'
];
```
**Impact**: Allows frontend to update is_paid through profile API endpoint (if authenticated)

---

## Key Findings Summary

1. **DEFAULT VALUE**: 
   - `fix_oauth_user_creation.sql` sets DEFAULT to `false` for OAuth users
   - `consolidate-to-user-profiles-migration.sql` trigger defaults to `true` for Ticketless users
   - `add-street-cleaning-migration-correct.sql` column definition defaults to `true`

2. **ACTIVE SETTING TO TRUE** (Explicit is_paid = true):
   - `/pages/api/alerts/create.ts` - Free alerts signup (line 213)
   - `/pages/api/stripe-webhook.ts` - New user creation (line 2099)
   - `/pages/api/stripe-webhook.ts` - Existing user update (line 2250)
   - `/scripts/fix-hellodoll-user.js` - One-off fix (line 91)
   - `/scripts/fix-mystreetcleaning-user.js` - One-off fix (line 36)
   - `/scripts/fix-hellodoll-profile.js` - One-off fix (line 52)
   - `/scripts/fix-mystreetcleaning2.js` - One-off fix (line 36)
   - `/sql/setup-randy-profile.sql` - Test user setup (line 44)

3. **SETTING TO FALSE**:
   - `/scripts/test-msc-direct.js` - Test script only (line 46)

4. **PRESERVING EXISTING VALUES**:
   - `/run-migration.js` - Preserves during migration (line 110)
   - `/manual-randy-migration.js` - Falls back to true if missing (line 103)
   - `/scripts/consolidate-tables.js` - Preserves during consolidation (line 112)

5. **BUSINESS LOGIC**:
   - **Comment pattern**: "All Ticketless America users are paid" appears in multiple locations
   - **Alert signups**: Free alert users are marked as "paid" 
   - **Stripe webhook**: Creates/updates all users as paid (regardless of actual payment)
   - **Migration scripts**: Mostly one-off fixes for test/problem users

---

## Potential Issues Identified

1. **CRITICAL**: Stripe webhook sets `is_paid: true` for ALL users, regardless of actual Stripe payment status
   - Line 2099: New users get `is_paid: true` 
   - Line 2250: Existing users get updated to `is_paid: true`
   - Comment says "All Ticketless users are paid" but no actual Stripe verification happens

2. **INCONSISTENCY**: Free alert signups marked as paid (line 213 in alerts/create.ts)
   - Comment: "Free users are considered 'paid' for alerts"
   - This conflates "free alerts" tier with "paid subscriber" status

3. **CONFLICTING DEFAULTS**:
   - `fix_oauth_user_creation.sql` defaults to `false`
   - `consolidate-to-user-profiles-migration.sql` trigger defaults to `true`
   - `add-street-cleaning-migration-correct.sql` defaults to `true`
   - Risk of inconsistent behavior depending on which migration ran

4. **UNPROTECTED ENDPOINT**: Profile endpoint allows updating is_paid if authenticated
   - Line 117 in `/pages/api/profile.ts` - users could potentially set their own is_paid status

