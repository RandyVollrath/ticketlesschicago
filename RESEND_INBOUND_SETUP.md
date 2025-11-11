# Resend Inbound Email Setup - Complete Guide

## Overview

This feature allows users to forward their utility bills to a unique email address, and we automatically process and store them as proof of residency.

**How it works:**
1. User gets unique forwarding address: `documents+{their-uuid}@autopilotamerica.com`
2. User sets up email forwarding from their utility provider (ComEd, Peoples Gas, etc.)
3. When bill arrives, Resend webhook delivers it to our API
4. We extract PDF, store in Supabase, delete old bills

---

## Setup Checklist

### ✅ 1. Create Supabase Storage Bucket

**Dashboard:** https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/storage/buckets

1. Click "New bucket"
2. **Name:** `residency-proofs-temp`
3. **Public:** NO (private)
4. **File size limit:** 10 MB
5. Click "Create bucket"

**Then add storage policies:**

Go to: https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/storage/policies

Click "New Policy" for `residency-proofs-temp` bucket:

**Policy 1: Service role full access**
```sql
CREATE POLICY "Service role full access"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'residency-proofs-temp')
WITH CHECK (bucket_id = 'residency-proofs-temp');
```

**Policy 2: Users can view their own files**
```sql
CREATE POLICY "Users can view their own residency proofs"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'residency-proofs-temp' AND
  (storage.foldername(name))[1] = 'proof' AND
  (storage.foldername(name))[2] = auth.uid()::text
);
```

---

### ✅ 2. Set Up Resend Inbound Domain

**Dashboard:** https://resend.com/inbound

#### Add Inbound Domain

1. Click "Add Inbound Domain"
2. **Domain:** `autopilotamerica.com`
3. Click "Add Domain"

#### Configure DNS Records

Resend will show you MX records to add. Go to your DNS provider (Cloudflare, Namecheap, etc.) and add:

**MX Record:**
```
Type: MX
Name: @ (or autopilotamerica.com)
Priority: 10
Value: inbound-smtp.resend.com
TTL: Auto (or 3600)
```

**SPF Record (if you don't have one):**
```
Type: TXT
Name: @
Value: v=spf1 include:_spf.resend.com ~all
TTL: Auto (or 3600)
```

**Verify Domain:**
- Wait 5-15 minutes for DNS propagation
- Click "Verify" in Resend dashboard
- Status should change to "Verified"

---

### ✅ 3. Create Resend Webhook

**Dashboard:** https://resend.com/webhooks

1. Click "Add Endpoint"
2. **URL:** `https://ticketlesschicago.com/api/email/process-residency-proof-resend`
3. **Events:** Check only `email.received`
4. **Description:** "Utility bill forwarding for residency proofs"
5. Click "Create Endpoint"

**Test the webhook:**
- Click "Send test event"
- Should return `200 OK` (might return error if no matching user, that's okay for now)

---

## Testing

### Test 1: Check Storage Bucket Exists

```bash
node scripts/check-storage-bucket.js
```

**Expected output:**
```
✅ residency-proofs-temp bucket exists!
```

---

### Test 2: Create Test User with Protection + Permit Zone

Run in Supabase SQL Editor:

```sql
-- Get a test user (or create one)
SELECT user_id, email, has_protection, has_permit_zone, email_forwarding_address
FROM user_profiles
WHERE email = 'your-test-email@example.com';

-- If test user doesn't have protection + permit zone, update:
UPDATE user_profiles
SET
  has_protection = true,
  has_permit_zone = true,
  vehicle_zone = 'Zone 1'
WHERE email = 'your-test-email@example.com';

-- Verify email forwarding address was auto-generated:
SELECT email_forwarding_address
FROM user_profiles
WHERE email = 'your-test-email@example.com';

-- Should show: documents+{uuid}@autopilotamerica.com
```

---

### Test 3: Send Real Test Email

**Option A: Forward a real utility bill**

1. Find a utility bill PDF on your computer
2. Email it to: `documents+{test-user-uuid}@autopilotamerica.com`
3. Attach the PDF
4. Send

**Option B: Use a test email service**

Use a service like https://ethereal.email or https://mailtrap.io to send test emails with PDF attachments.

---

### Test 4: Check Resend Webhook Logs

**Dashboard:** https://resend.com/webhooks

1. Click on your webhook endpoint
2. Click "Recent Deliveries"
3. Should see the incoming email event
4. Check response code: Should be `200`
5. View response body: Should show `"success": true`

**If you see errors:**
- `404 User not found` - Make sure user UUID in email address is correct
- `400 User does not have protection` - Update user profile to have `has_protection = true`
- `400 User does not require proof of residency` - Update user to have `has_permit_zone = true`
- `400 No PDF attachment found` - Make sure you attached a PDF file

---

### Test 5: Verify File Uploaded to Supabase

**Dashboard:** https://supabase.com/dashboard/project/dzhqolbhuqdcpngdayuq/storage/buckets/residency-proofs-temp

Or run SQL query:

```sql
-- Check user profile was updated
SELECT
  user_id,
  email,
  residency_proof_path,
  residency_proof_uploaded_at,
  residency_proof_verified
FROM user_profiles
WHERE email = 'your-test-email@example.com';

-- Should show:
-- residency_proof_path: proof/{uuid}/2025-01-10/bill.pdf
-- residency_proof_uploaded_at: (recent timestamp)
-- residency_proof_verified: false
```

Navigate in Supabase Storage:
```
residency-proofs-temp/
  └── proof/
      └── {user-uuid}/
          └── 2025-01-10/
              └── bill.pdf
```

---

### Test 6: Test Old Bill Deletion

Send a second utility bill to the same email address:

1. Send another PDF to `documents+{test-user-uuid}@autopilotamerica.com`
2. Check Supabase storage
3. Should only see ONE bill (the newest one)
4. Old bill folder should be deleted

---

## Production Monitoring

### Check Webhook Activity

```sql
-- See how many bills were uploaded today
SELECT
  COUNT(*) as bills_received_today,
  COUNT(DISTINCT user_id) as unique_users
FROM user_profiles
WHERE residency_proof_uploaded_at::date = CURRENT_DATE;
```

### Check for Failed Deliveries

**Resend Dashboard:** https://resend.com/webhooks

- Check "Recent Deliveries"
- Filter by "Failed" status
- Common failures:
  - User not found (wrong UUID in email)
  - No PDF attachment (user forwarded wrong email)
  - Missing protection/permit zone

---

## User Instructions

### How to Set Up Email Forwarding

**For ComEd:**
1. Log in to ComEd account
2. Go to "Paperless Billing" settings
3. Add forwarding address: `documents+{your-uuid}@autopilotamerica.com`
4. Save

**For Peoples Gas:**
1. Log in to Peoples Gas account
2. Go to "Communication Preferences"
3. Add secondary email: `documents+{your-uuid}@autopilotamerica.com`
4. Save

**For Gmail (if bill arrives in Gmail):**
1. Click Settings (gear icon) → "See all settings"
2. Go to "Forwarding and POP/IMAP"
3. Click "Add a forwarding address"
4. Enter: `documents+{your-uuid}@autopilotamerica.com`
5. Verify forwarding address
6. Create filter to auto-forward bills:
   - Settings → Filters and Blocked Addresses → "Create a new filter"
   - From: `noreply@comed.com` (or your utility provider)
   - Has attachment: yes
   - Forward to: `documents+{your-uuid}@autopilotamerica.com`

---

## Security & Privacy

### What We Store
- **Only the most recent utility bill** (old bills deleted automatically)
- **Stored for 31 days max** (cleanup cron runs daily)
- **Encrypted at rest** (Supabase AES-256 encryption)
- **Private bucket** (not publicly accessible)

### Who Can Access
- **User:** Can view their own bills via signed URL
- **Remitter:** Can access via API endpoint for city sticker renewal
- **Service role:** Full access for automated processing

### Audit Trail
- Every access is logged in `license_access_log` table
- Users can see access history in settings page
- Alerts on unusual access patterns

---

## Troubleshooting

### "Bucket not found" error
- Run: `node scripts/check-storage-bucket.js`
- Create bucket in Supabase dashboard (see Step 1 above)

### "Domain not verified" error
- Check DNS records are correct
- Wait 15 minutes for DNS propagation
- Use https://mxtoolbox.com to verify MX records

### "No PDF attachment found" error
- User forwarded wrong email (no attachment)
- Attachment is not PDF (maybe image or doc)
- Tell user to only forward bills with PDF attachments

### "User not found" error
- UUID in email address doesn't match any user
- Check user_profiles table for correct UUID
- Make sure email address is exactly: `documents+{uuid}@autopilotamerica.com`

### "User does not have protection" error
- User's `has_protection` is false
- They need to subscribe to Protection service first

### "User does not require proof of residency" error
- User's `has_permit_zone` is false
- They don't live in a permit zone, so no residency proof needed
- This feature is only for permit zone users

---

## Annual Maintenance

### Update Cleanup Cron (Already Set to 31 Days)
- File: `pages/api/cron/cleanup-residency-proofs.ts`
- Deletes bills older than 31 days
- Runs daily via Vercel Cron

### Monitor Storage Usage
```sql
-- Check total storage used
SELECT
  COUNT(*) as total_bills,
  SUM(metadata->>'size')::bigint / 1024 / 1024 as total_mb
FROM storage.objects
WHERE bucket_id = 'residency-proofs-temp';
```

### Review Access Logs
```sql
-- Who accessed residency proofs in last 30 days
SELECT
  user_id,
  accessed_by,
  COUNT(*) as access_count
FROM license_access_log
WHERE reason = 'city_sticker_renewal'
  AND accessed_at > NOW() - INTERVAL '30 days'
GROUP BY user_id, accessed_by
ORDER BY access_count DESC;
```

---

## Summary

✅ Storage bucket created: `residency-proofs-temp`
✅ DNS configured for `autopilotamerica.com`
✅ Resend webhook listening for `email.received`
✅ Webhook endpoint: `/api/email/process-residency-proof-resend`
✅ Auto-deletes old bills (keeps only most recent)
✅ 31-day max retention policy
✅ Encrypted, private storage

**Email format:** `documents+{user-uuid}@autopilotamerica.com`
**Supported formats:** PDF attachments only
**Max file size:** 10 MB
**Retention:** 31 days max

**Next step:** Test with real utility bill forwarding!
