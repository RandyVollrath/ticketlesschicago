# 🧪 Complete Testing Guide: Permit Flow with Email Forwarding

## Overview
This guide walks you through testing the complete permit signup flow, including:
1. Driver's License upload, verification, and 48-hour deletion
2. Proof of Residency via email forwarding setup
3. Opt-out permit checkbox behavior
4. Data retention policies (60 days for bills, 48 hours for licenses)

---

## Pre-Test Setup

### 1. Ensure Cron Jobs Are Configured in Vercel

Check that these cron jobs exist:
- `/api/cron/cleanup-license-images` - Runs daily, deletes licenses 48hrs after access
- `/api/cron/cleanup-residency-proofs` - Runs daily, deletes bills older than 60 days

### 2. Database Fields Required

Ensure you've run the SQL migration:
```sql
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS permit_requested BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS drivers_license_url TEXT,
  ADD COLUMN IF NOT EXISTS proof_of_residency_url TEXT,
  ADD COLUMN IF NOT EXISTS permit_zone_number TEXT,
  ADD COLUMN IF NOT EXISTS permit_application_status TEXT DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS home_address_full TEXT;
```

### 3. Test Email Account
You'll need access to a test Gmail account to set up email forwarding.

---

## Test 1: Complete Permit Signup Flow (Opt-Out Model)

### Step 1: Navigate to Protection Page
1. Open `http://localhost:3002/protection` (or your production URL)
2. Scroll to the "Get Ticket Protection" section

### Step 2: Enter Address in Permit Zone
1. In "Street Address" field, enter: `2300 N Lakewood Ave`
2. Wait 500ms for debounce
3. **Expected:** Yellow box appears showing:
   - "🅿️ Permit Parking Zone Detected"
   - "Zone: 143"
   - "Address Range: 2300-2398 N LAKEWOOD AVE"

### Step 3: Verify Permit Checkbox is Auto-Checked
1. **Expected:** Blue box appears below with:
   - Checkbox is **CHECKED** ✅
   - Text: "✅ Include residential parking permit ($30)"
   - Description: "We'll process your permit and charge $30 at renewal..."

### Step 4: Test Opt-Out (Unchecking)
1. Click the checkbox to **UNCHECK** it
2. **Expected:**
   - Box turns yellow/red
   - Text changes to: "⚠️ I don't need a permit (uncheck to decline)"
   - Warning: "Without a permit, you may receive parking tickets..."
3. **Check Pricing Section:**
   - With checkbox UNCHECKED: NO $30 line item
   - Re-check the box
   - With checkbox CHECKED: "$30 (charged at renewal)" appears

### Step 5: Complete Checkout
1. Enter email: `test-permit-$(date +%s)@gmail.com`
2. Enter phone: `(555) 123-4567`
3. Select Monthly billing
4. Check the consent checkbox
5. Click "Get Complete Protection - $12"
6. Use Stripe test card: `4242 4242 4242 4242`
7. Complete payment

### Step 6: Verify Database After Checkout
```bash
# Connect to your Supabase database
psql [your-connection-string]

# Check the user's permit_requested field
SELECT
  email,
  permit_requested,
  permit_zone_number,
  permit_application_status,
  home_address_full
FROM user_profiles
WHERE email LIKE 'test-permit%'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected Results:**
- `permit_requested`: `true`
- `permit_zone_number`: `143`
- `permit_application_status`: `pending_documents` or `not_started`
- `home_address_full`: `2300 N Lakewood Ave`

### Step 7: Check Welcome Email
1. Check the test email inbox
2. **Expected:**
   - Subject: "Welcome to Autopilot America - Complete Your Profile"
   - Yellow box with: "🅿️ Parking Permit Setup Required"
   - Message about setting up email forwarding

---

## Test 2: Driver's License Upload & 48-Hour Deletion

### Step 1: Log In to Settings
1. Click the magic link from welcome email
2. Navigate to `/settings`
3. Scroll to "Driver's License" accordion
4. **Expected:** Badge shows "Required" (red)

### Step 2: Upload Driver's License
1. Click "Choose File" for front of license
2. Select a test image (use a fake/redacted license image)
3. Click "Choose File" for back of license
4. Select another test image
5. Enter expiry date: `2027-12-31`
6. Check both consent checkboxes:
   - "I consent to Autopilot America storing..."
   - "I consent to multi-year reuse..." (if you want to keep it beyond 48hrs)
7. Click "📤 Upload License"

### Step 3: Verify Upload Success
**Expected:**
- Green success message
- Badge changes to "Uploaded" (green)
- Images are displayed

### Step 4: Verify Database Storage
```sql
SELECT
  user_id,
  license_image_path,
  license_image_back_path,
  license_image_uploaded_at,
  license_last_accessed_at,
  license_reuse_consent_given,
  license_image_verified
FROM user_profiles
WHERE email LIKE 'test-permit%'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:**
- `license_image_path`: blob URL (front)
- `license_image_back_path`: blob URL (back)
- `license_image_uploaded_at`: current timestamp
- `license_last_accessed_at`: NULL (not accessed yet)
- `license_reuse_consent_given`: true/false (based on checkbox)
- `license_image_verified`: false (until OCR processes it)

### Step 5: Verify License Access Logging
1. Navigate to `/api/city-sticker/get-driver-license` endpoint
2. Call it with proper authentication to retrieve license
3. **Expected:** `license_last_accessed_at` updates in database

### Step 6: Test 48-Hour Deletion (Manual Trigger)

**Option A: Wait 48 hours** (not practical for testing)

**Option B: Manually trigger cleanup cron** (recommended)
```bash
# Temporarily modify the cleanup script to use 1 minute instead of 48 hours
# OR manually update the database timestamp

# Update timestamp to simulate 48+ hours ago
psql [connection] -c "
UPDATE user_profiles
SET license_last_accessed_at = NOW() - INTERVAL '49 hours'
WHERE email LIKE 'test-permit%';
"

# Trigger the cleanup cron
curl -X POST http://localhost:3002/api/cron/cleanup-license-images \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "License image cleanup completed",
  "results": {
    "optedOutDeleted": 1,
    "abandonedDeleted": 0,
    "errors": []
  }
}
```

### Step 7: Verify License Deletion
```sql
SELECT
  license_image_path,
  license_image_back_path,
  license_last_accessed_at
FROM user_profiles
WHERE email LIKE 'test-permit%';
```

**Expected:**
- `license_image_path`: NULL
- `license_image_back_path`: NULL
- `license_last_accessed_at`: NULL

---

## Test 3: Proof of Residency Email Forwarding Setup

### Step 1: Navigate to Permit Section
1. Log into `/settings`
2. Scroll to "🅿️ Residential Parking Permit - Proof of Residency"
3. **Expected:**
   - Only visible if `permit_requested = true`
   - Badge shows "Setup Required" (red)
   - Shows permit zone number: 143
   - Yellow warning box about 30-day freshness

### Step 2: Get Forwarding Email
1. Look for the blue box with "Your Forwarding Address"
2. **Expected format:** `documents+{user_id}@autopilotamerica.com`
3. Click "Copy" button
4. **Expected:** "Copied!" confirmation

### Step 3: Set Up Gmail Forwarding (ComEd Example)
1. Open Gmail in another tab
2. In search bar, type: `from:@comed.com`
3. Click the dropdown arrow → "Show search options"
4. Fill in:
   - **From:** `@comed.com`
   - **Has the words:** `bill OR statement`
5. Click "Create filter"
6. Check "Forward it to"
7. Enter: `documents+{user_id}@autopilotamerica.com`
8. Gmail will ask to verify - check your forwarding email inbox
9. Click verification link
10. Return to Gmail and complete filter creation

### Step 4: Test Email Forwarding
**Option A: Use a real ComEd bill**
- Forward an existing bill email to yourself
- It should auto-forward to your documents email

**Option B: Send a test email**
```bash
# Use a service like SendGrid or your own email
# Send an email FROM a comed.com-like address
# Subject: "Your ComEd Bill for November 2025"
# Attach a PDF utility bill
```

### Step 5: Verify Email Receipt & Processing
1. Check if email arrived at your processing endpoint
2. **Expected:** Email processing API should:
   - Receive email at `/api/email/process-residency-proof`
   - Extract PDF attachment
   - Parse date from bill
   - Verify date is < 30 days old
   - Store in Supabase Storage bucket: `residency-proofs-temp`
   - Update database:
     ```sql
     UPDATE user_profiles SET
       residency_proof_path = 'path/to/bill.pdf',
       residency_proof_uploaded_at = NOW(),
       residency_proof_verified = true
     WHERE user_id = '{user_id}';
     ```

### Step 6: Verify in Settings Page
1. Refresh `/settings` page
2. Navigate to permit section
3. **Expected:**
   - Badge changes to "Active" (green)
   - Green success box showing:
     - "✅ Proof of Residency on File"
     - "Last received: [date]"

---

## Test 4: Bill Retention Policy (60 Days)

### Step 1: Verify Current Retention Period
```bash
# Check the cleanup cron code
cat pages/api/cron/cleanup-residency-proofs.ts | grep "days"
```

**Expected:** Should see `60` days, not 31

### Step 2: Manually Trigger Cleanup (Simulation)
```bash
# Update a test bill to be 61 days old
psql [connection] -c "
UPDATE user_profiles
SET residency_proof_uploaded_at = NOW() - INTERVAL '61 days'
WHERE email LIKE 'test-permit%';
"

# Trigger cleanup cron
curl -X POST http://localhost:3002/api/cron/cleanup-residency-proofs \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Cleaned up 1 residency proofs (60+ days old)",
  "deletedCount": 1,
  "errors": undefined
}
```

### Step 3: Verify Deletion
```sql
SELECT
  residency_proof_path,
  residency_proof_uploaded_at
FROM user_profiles
WHERE email LIKE 'test-permit%';
```

**Expected:**
- `residency_proof_path`: NULL
- `residency_proof_uploaded_at`: NULL

### Step 4: Test Bills UNDER 60 Days Are Kept
```bash
# Set bill to 59 days old
psql [connection] -c "
UPDATE user_profiles
SET residency_proof_uploaded_at = NOW() - INTERVAL '59 days',
    residency_proof_path = 'test/bill.pdf'
WHERE email LIKE 'test-permit%';
"

# Trigger cleanup
curl -X POST http://localhost:3002/api/cron/cleanup-residency-proofs \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

**Expected:**
- `deletedCount`: 0
- Bill should still exist in database

---

## Test 5: Edge Cases & Error Handling

### Test 5.1: Opt-Out After Detecting Permit Zone
1. Enter permit zone address
2. Uncheck permit box
3. Complete checkout
4. **Verify Database:**
   ```sql
   SELECT permit_requested FROM user_profiles WHERE email = '[test-email]';
   ```
   **Expected:** `false`

5. **Verify Settings Page:**
   - Log in
   - Navigate to `/settings`
   - **Expected:** NO permit section appears (should be hidden)

### Test 5.2: Non-Permit Zone Address
1. Go to `/protection`
2. Enter address NOT in permit zone: `123 Main St`
3. **Expected:**
   - No permit zone warning
   - No permit checkbox
   - No $30 fee

### Test 5.3: License Upload Without Consent
1. Upload license images
2. DO NOT check consent boxes
3. Try to submit
4. **Expected:** Button is disabled (gray), cannot click

### Test 5.4: Email Forwarding Without Setup
1. User with `permit_requested = true`
2. Navigate to permit section
3. **Expected:**
   - Badge: "Setup Required" (red)
   - No green success box
   - Instructions visible

---

## Quick Verification Checklist

Use this for rapid testing after deployment:

- [ ] Permit checkbox is auto-checked when zone detected
- [ ] Permit checkbox can be unchecked (opt-out)
- [ ] Pricing shows $30 only when checked
- [ ] `permit_requested` saved correctly in database
- [ ] Welcome email mentions permit setup (if opted in)
- [ ] Settings shows permit section only if `permit_requested = true`
- [ ] Email forwarding instructions display correctly
- [ ] Forwarding email format: `documents+{user_id}@autopilotamerica.com`
- [ ] Bill cleanup runs after 60 days, not 30
- [ ] License cleanup runs after 48 hours
- [ ] Driver's license upload works
- [ ] `license_last_accessed_at` updates when viewed

---

## Database Queries for Verification

### Check Permit User
```sql
SELECT
  email,
  permit_requested,
  permit_zone_number,
  permit_application_status,
  residency_proof_path,
  residency_proof_uploaded_at,
  license_image_path,
  license_last_accessed_at,
  created_at
FROM user_profiles
WHERE email = '[test-email]'
LIMIT 1;
```

### Check Bill Age
```sql
SELECT
  email,
  residency_proof_path,
  residency_proof_uploaded_at,
  AGE(NOW(), residency_proof_uploaded_at) as bill_age
FROM user_profiles
WHERE residency_proof_path IS NOT NULL
ORDER BY residency_proof_uploaded_at DESC;
```

### Check License Access History
```sql
SELECT
  email,
  license_image_path,
  license_image_uploaded_at,
  license_last_accessed_at,
  AGE(NOW(), license_last_accessed_at) as time_since_access,
  license_reuse_consent_given
FROM user_profiles
WHERE license_image_path IS NOT NULL;
```

---

## Troubleshooting

### Permit Checkbox Not Appearing
- Check: Is address actually in a permit zone?
- Check: Did `usePermitZoneCheck` hook complete?
- Check browser console for errors

### Email Forwarding Not Working
- Verify Gmail filter was created correctly
- Check if forwarding address was verified
- Look for emails in spam/junk
- Check `/api/email/process-residency-proof` logs

### License Not Deleting After 48 Hours
- Check: Was `license_reuse_consent_given` set to `false`?
- Check: Did cron job run? (Vercel logs)
- Check: Is `license_last_accessed_at` older than 48 hours?

### Bills Not Deleting After 60 Days
- Check: Is `residency_proof_uploaded_at` older than 60 days?
- Check: Did cron job run? (Vercel logs)
- Verify cron is scheduled in vercel.json

---

## Production Deployment Checklist

Before deploying to production:

1. [ ] SQL migration applied to production database
2. [ ] Cron secrets configured in Vercel: `CRON_SECRET`
3. [ ] Cron jobs scheduled in vercel.json:
   ```json
   {
     "crons": [
       {
         "path": "/api/cron/cleanup-license-images",
         "schedule": "0 2 * * *"
       },
       {
         "path": "/api/cron/cleanup-residency-proofs",
         "schedule": "0 3 * * *"
       }
     ]
   }
   ```
4. [ ] Email forwarding domain configured (MX records for `@autopilotamerica.com`)
5. [ ] Supabase storage buckets exist:
   - `license-images-temp`
   - `residency-proofs-temp`
6. [ ] Test with real Chicago address in permit zone
7. [ ] Test email forwarding with real Gmail account
8. [ ] Monitor logs for 48 hours after deployment

---

## Next Steps After Testing

Once everything works:

1. **Document for customer support** - How to help users set up forwarding
2. **Create video tutorial** - Gmail forwarding walkthrough
3. **Set up monitoring** - Alert if bills haven't been received in 45 days
4. **Build reminder system** - Email users if proof of residency > 45 days old
5. **OCR implementation** - Auto-extract license data from uploads
6. **Permit auto-submission** - Submit to Chicago when all docs ready

---

## Questions to Answer During Testing

- [ ] How long does license OCR/verification take?
- [ ] What happens if user uploads license but doesn't consent to reuse?
- [ ] Can users re-upload license after 48-hour deletion?
- [ ] What if utility bill is older than 30 days when received?
- [ ] How do we handle users with no utility bills (college students, etc.)?
- [ ] Should we send reminder email before deleting license?

---

**Testing completed by:** _______________
**Date:** _______________
**Environment:** [ ] Local [ ] Staging [ ] Production
**All tests passed:** [ ] Yes [ ] No (see notes below)

**Notes:**
_______________________________________________________________
_______________________________________________________________
_______________________________________________________________
