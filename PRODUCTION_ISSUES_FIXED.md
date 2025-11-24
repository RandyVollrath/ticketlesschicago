# Production Issues - Fixed & Pending

## Status: 1 Fixed, 1 Pending User Action

---

## ✅ FIXED: Email Forwarding UUID Issue

### Problem
Production logs showed email bouncing to incorrect forwarding address:
```
documents+[all-zeros-uuid]@autopilotamerica.com
```

Instead of actual user ID like:
```
documents+[real-user-uuid]@autopilotamerica.com
```

### Root Cause
**File:** `/pages/settings.tsx` (line 1776)

The component was using `user?.id` which could be undefined during component render:
```typescript
<EmailForwardingSetup
  forwardingEmail={`documents+${user?.id}@autopilotamerica.com`}
/>
```

### Fix Applied
Changed to use `profile.user_id` with fallback to `user?.id`:
```typescript
<EmailForwardingSetup
  forwardingEmail={`documents+${profile.user_id || user?.id}@autopilotamerica.com`}
/>
```

**Why this works:**
- `profile.user_id` comes directly from database query in `loadUserData()`
- Always populated when profile data loads
- More reliable than auth state `user?.id` which may have timing issues

### Testing Steps
1. Deploy to production
2. Log in as existing permit user
3. Navigate to Settings → Permit section
4. Verify forwarding email shows real UUID, not all zeros
5. Test sending email to that address

---

## ⚠️ PENDING: Google Vision API Billing Not Enabled

### Problem
Production logs show driver's license validation failing:
```
This API method requires billing to be enabled.
Please enable billing on project #176303501745
```

### Impact
- Driver's license uploads fail validation
- Users cannot complete permit document requirements
- OCR extraction (expiry date detection) not working

### Solution Required
**Action needed by project owner:**

1. **Go to Google Cloud Console**
   - Visit: https://console.cloud.google.com/
   - Select project #176303501745

2. **Enable Billing**
   - Navigate to: Billing → Link a billing account
   - If no billing account exists, create one
   - Link it to the project

3. **Enable Cloud Vision API**
   - Navigate to: APIs & Services → Library
   - Search for "Cloud Vision API"
   - Click "Enable" (if not already enabled)
   - Verify billing is active

4. **Verify API Key/Service Account**
   - Navigate to: APIs & Services → Credentials
   - Ensure `GOOGLE_CLOUD_VISION_API_KEY` in Vercel env vars is valid
   - Or ensure service account JSON is properly configured

### Affected Endpoints
- `/api/protection/validate-license` - License validation
- `/api/protection/upload-license` - License upload with OCR

### Cost Estimate
Google Vision API pricing (as of 2024):
- First 1,000 requests/month: FREE
- 1,001-5,000,000 requests: $1.50 per 1,000
- Estimated monthly cost: $0-$10 for small user base

### Testing After Fix
Once billing enabled:
```bash
# Test license validation endpoint
curl -X POST https://ticketlesschicago.com/api/protection/validate-license \
  -H "Content-Type: application/json" \
  -d '{"imageUrl": "test-license-image-url", "side": "front"}'

# Should return:
# { "valid": true, "detectedText": "...", "expiryDate": "..." }
```

---

## Deployment Checklist

### Before Deploying Email Fix
- [x] Fixed `user?.id` to `profile.user_id || user?.id`
- [x] Dev server compiled successfully (port 3002)
- [ ] Commit changes
- [ ] Deploy to production
- [ ] Test with real user account

### After Google Vision Billing Enabled
- [ ] Verify API is enabled in Google Cloud Console
- [ ] Test license validation endpoint
- [ ] Test full driver's license upload flow
- [ ] Verify OCR expiry date detection works
- [ ] Monitor error logs for 24 hours

---

## Deployment Commands

```bash
# Commit the email forwarding fix
git add pages/settings.tsx
git commit -m "Fix email forwarding UUID issue - use profile.user_id instead of user?.id

- Changes forwarding email generation to use profile.user_id with fallback
- Prevents all-zeros UUID from being displayed
- More reliable since profile data is loaded from database
"

# Push to production
git push origin main

# Deploy to Vercel (if auto-deploy not enabled)
npx vercel --prod
```

---

## Monitoring After Deployment

### Email Forwarding Fix
Check these after deployment:
1. **Verify forwarding email displays correctly**
   - Log in as permit user
   - Check Settings → Permit section
   - Confirm email shows real UUID

2. **Test email receipt**
   - Send test email to `documents+{user-id}@autopilotamerica.com`
   - Check if it processes correctly (no bounce)
   - Verify bill gets stored in database

3. **Check error logs**
   ```bash
   vercel logs --follow
   ```
   - Look for any forwarding email errors
   - Confirm no more all-zeros UUIDs in logs

### Google Vision API
After billing enabled:
1. **Test license upload**
   - Upload driver's license front/back
   - Verify validation passes
   - Check if expiry date is detected

2. **Monitor API usage**
   - Google Cloud Console → APIs & Services → Dashboard
   - Check Vision API usage
   - Set budget alerts if needed

---

## Support Queries

### Check user's forwarding email in database
```sql
SELECT
  email,
  user_id,
  permit_requested,
  permit_zone_number,
  CONCAT('documents+', user_id, '@autopilotamerica.com') as forwarding_email
FROM user_profiles
WHERE permit_requested = true
ORDER BY created_at DESC
LIMIT 10;
```

### Check failed license uploads
```sql
SELECT
  email,
  license_image_path,
  license_image_uploaded_at,
  license_valid_until
FROM user_profiles
WHERE permit_requested = true
  AND license_image_path IS NULL
ORDER BY created_at DESC;
```

---

## Questions for Product Team

1. **Email Forwarding Verification**
   - Should we add a verification step to confirm forwarding is working?
   - Send test email and wait for user to receive it?

2. **Google Vision API Alternatives**
   - If cost becomes an issue, consider:
     - AWS Textract
     - Azure Computer Vision
     - Tesseract (open source OCR)
   - Current approach assumes Google Vision for consistency

3. **License Upload Fallback**
   - What should happen if Vision API fails?
   - Allow upload without validation?
   - Show error and block upload?

---

## Contact

**Deployment Issues:** Randy Vollrath
**Google Cloud Access:** [Project owner email]
**Monitoring Dashboard:** https://vercel.com/ticketless-chicago/dashboard

**Last Updated:** 2025-11-23
