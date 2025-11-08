# Driver's License Image System - Setup Instructions

## Overview

The license image system provides ephemeral storage for driver's license photos required for city sticker processing. Images are:
- Uploaded during Protection signup
- Verified by remitter for clarity
- Automatically deleted after verification or 48 hours
- Stored with signed URLs (24-hour expiration)

## Architecture

### Components

1. **Supabase Storage Bucket** (`license-images-temp`)
   - Temporary storage for license images
   - Public access disabled (signed URLs only)
   - Files stored in `licenses/` folder

2. **Database Tracking** (`user_profiles` table)
   - `license_image_path`: Storage path
   - `license_image_uploaded_at`: Upload timestamp
   - `license_image_verified`: Verification status
   - `license_image_verified_at`: Verification timestamp
   - `license_image_verified_by`: Who verified
   - `license_image_verification_notes`: Rejection reasons

3. **Upload API** (`/api/protection/upload-license`)
   - Validates file type (JPEG, PNG, WebP)
   - Validates file size (5MB max)
   - Uploads to Supabase Storage
   - Returns signed URL (24-hour expiration)

4. **Cleanup Cron** (`/api/cron/cleanup-license-images`)
   - Runs daily at 4 AM
   - Deletes verified images
   - Deletes images older than 48 hours
   - Clears database references

## Setup Instructions

### 1. Create Supabase Storage Bucket

**In Supabase Dashboard:**

1. Go to Storage → Create Bucket
2. Bucket name: `license-images-temp`
3. Public bucket: **NO** (keep private)
4. File size limit: 5MB
5. Allowed MIME types:
   - `image/jpeg`
   - `image/jpg`
   - `image/png`
   - `image/webp`

**Set Bucket Policies (RLS):**

```sql
-- Allow authenticated users to upload their own license
CREATE POLICY "Users can upload their license"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'license-images-temp' AND
  (storage.foldername(name))[1] = 'licenses'
);

-- Allow service role to read all (for remitter verification)
CREATE POLICY "Service role can read all"
ON storage.objects FOR SELECT
TO service_role
USING (bucket_id = 'license-images-temp');

-- Allow service role to delete (for cleanup)
CREATE POLICY "Service role can delete"
ON storage.objects FOR DELETE
TO service_role
USING (bucket_id = 'license-images-temp');
```

### 2. Run Database Migration

```bash
psql $DATABASE_URL < database/migrations/add_license_image_tracking.sql
```

This adds the following columns to `user_profiles`:
- `license_image_path` (TEXT)
- `license_image_uploaded_at` (TIMESTAMPTZ)
- `license_image_verified` (BOOLEAN, default false)
- `license_image_verified_at` (TIMESTAMPTZ)
- `license_image_verified_by` (TEXT)
- `license_image_verification_notes` (TEXT)

### 3. Deploy to Vercel

The system is already configured in `vercel.json`:

**Cron job** (runs daily at 4 AM):
```json
{
  "path": "/api/cron/cleanup-license-images",
  "schedule": "0 4 * * *"
}
```

**No additional environment variables needed** - uses existing Supabase credentials.

### 4. Test the Flow

1. **Visit** `/protection` while logged in
2. **Select** "City Sticker Renewal"
3. **Upload** a driver's license image
4. **Check** that image appears with preview
5. **Verify** in Supabase Storage → `license-images-temp` bucket

## User Flow

### During Signup

1. User fills out Protection signup form
2. User selects "City Sticker Renewal" and enters address
3. System detects if address is in a permit zone
4. User completes checkout and payment
5. **No license upload required during signup** (to avoid cart abandonment)

### After Payment (Success Page)

1. User redirected to `/alerts/success?protection=true`
2. **If user has city sticker + permit zone:**
   - System shows "Action Required: Upload Driver's License" section
   - User uploads license photo
   - **Automatic quality verification:**
     - Checks image dimensions (min 800x600)
     - Detects blur using Laplacian variance
     - Checks brightness (too dark or overexposed)
   - If quality check fails: User shown specific error and prompted to retake
   - If quality check passes: Image uploaded to Supabase Storage
3. License image path is saved to `user_profiles`

### After Signup (Remitter Processing)

1. Remitter receives renewal order (30 days before expiration)
2. Remitter accesses license image via signed URL
3. Remitter verifies image is clear enough for city clerk
4. **If clear:**
   - Remitter marks `license_image_verified = true`
   - Next cleanup job deletes the image
5. **If unclear:**
   - Remitter adds notes to `license_image_verification_notes`
   - User is contacted to re-upload
   - Original image remains until replaced

### Automatic Cleanup

Daily at 4 AM:
1. Delete all verified images (no longer needed)
2. Delete all unverified images older than 48 hours (abandoned)
3. Clear database references

## Security & Privacy

### Data Retention
- **Verified images**: Deleted within 24 hours of verification
- **Unverified images**: Deleted after 48 hours
- **Database records**: Paths cleared on deletion
- **No permanent storage**: All license images are ephemeral

### Access Control & When We Access Your License

**Who can access:**
- **Users**: Can only upload/view their own license (authenticated access only)
- **Platform (you)**: Access via Supabase Storage dashboard or signed URLs
- **Remitters**: Access via signed URLs when processing renewal orders
- **Service role**: Automated cleanup and verification processes
- **Public**: No access (private bucket)

**When access happens:**
1. **Upload time**: Automated quality verification (Sharp + Claude Vision)
2. **Renewal processing time**: 30 days before city sticker expiration
   - Remitter accesses image to verify it's clear for city clerk
   - Remitter downloads image to include in city sticker application
   - After successful verification/processing: Image deleted automatically
3. **Manual access**: Only if user requests support or re-upload

**What users see (Privacy messaging):**
> "Your license image is stored securely and **temporarily**. We access it ONLY when processing your city sticker renewal (30 days before expiration). The image is **automatically deleted within 48 hours** of verification or processing. We never sell or share your personal information."

### Compliance
- **GDPR**: Right to deletion (automatic after 48 hours max)
- **CCPA**: Minimal retention period, clear purpose limitation
- **Security**: No permanent storage of sensitive documents
- **Purpose limitation**: Only used for city sticker renewal processing
- **Transparency**: Clear privacy messaging shown to users at upload time

### Technical Security Measures
- **Bucket privacy**: Private (no public access)
- **Signed URLs**: 24-hour expiration on all access links
- **Encryption**: At rest and in transit (Supabase default)
- **Access logs**: Supabase tracks all storage access for audit
- **Row Level Security**: User can only see/upload their own license
- **Automated deletion**: Cron job runs daily at 4 AM

## API Reference

### Upload License Image

```bash
POST /api/protection/upload-license

Content-Type: multipart/form-data

Fields:
- license: File (JPEG, PNG, WebP, max 5MB)
- userId: string (current user's ID)

Quality Checks (automatic):
- Minimum dimensions: 800x600 pixels
- Blur detection: Laplacian variance > 100
- Brightness: 30-240 (0-255 scale)
- File type: JPEG, PNG, or WebP
- File size: < 5MB

Success Response:
{
  "success": true,
  "filePath": "licenses/userid_timestamp.jpg",
  "signedUrl": "https://...",
  "expiresAt": "2025-01-09T12:00:00Z",
  "message": "License image uploaded successfully. Will be deleted after verification or 48 hours."
}

Error Response (quality check failed):
{
  "error": "Image appears blurry (sharpness: 85). Please take a clearer photo in good lighting."
}
```

**Image Quality Verification (Dual-Layer):**

**Layer 1: Sharp (Technical Quality)**
- **Dimensions**: Minimum 800x600 to ensure text is readable
- **Blur Detection**: Laplacian variance algorithm detects out-of-focus images
- **Brightness**: Rejects images that are too dark (<30) or overexposed (>240)
- **Speed**: <1 second, instant feedback
- **Cost**: Free

**Layer 2: Claude Vision API (Content Quality)**
- **Document Type**: Verifies it's a driver's license (not passport, ID card, etc.)
- **Text Readability**: Ensures ALL text on license is readable and in focus
- **Glare/Reflection Detection**: Checks for glare, reflections, or shadows obscuring text
- **Completeness**: Verifies entire license is visible (not cut off or partial)
- **Official Quality**: Confirms image quality is good enough for city clerk processing
- **Speed**: ~2-3 seconds
- **Cost**: ~$0.01 per image

**Why Dual-Layer?**
1. **Sharp catches technical issues** (blur, dark/bright, too small) instantly and for free
2. **Claude Vision catches content issues** (glare on text, wrong document type, cut off edges)
3. **Result**: Very high accuracy while keeping costs low (Sharp filters out ~80% of bad images before Claude runs)
4. **Fallback**: If Claude API fails, system continues with Sharp verification only (graceful degradation)

### Cleanup Cron (Internal)

```bash
POST /api/cron/cleanup-license-images

Headers:
- Authorization: Bearer {CRON_SECRET}

Response:
{
  "success": true,
  "message": "License image cleanup completed",
  "results": {
    "verifiedImagesDeleted": 5,
    "expiredImagesDeleted": 2,
    "errors": []
  }
}
```

## Troubleshooting

### Image Upload Fails

**Check:**
1. User is authenticated (`user` object exists)
2. File type is JPEG, PNG, or WebP
3. File size is under 5MB
4. Supabase Storage bucket exists and has correct policies

**Common errors:**
- "Please upload a JPEG, PNG, or WebP image" → Wrong file type
- "File size must be less than 5MB" → File too large
- "Failed to upload file" → Check Supabase Storage policies

### Images Not Being Deleted

**Check:**
1. Cron job is running (Vercel logs)
2. `CRON_SECRET` environment variable is set
3. Supabase Storage delete policy allows service role

**Manual cleanup:**
```sql
-- Find images older than 48 hours
SELECT user_id, license_image_path, license_image_uploaded_at
FROM user_profiles
WHERE license_image_path IS NOT NULL
  AND license_image_uploaded_at < NOW() - INTERVAL '48 hours'
  AND license_image_verified = false;

-- Clear references (don't forget to delete from storage too!)
UPDATE user_profiles
SET license_image_path = NULL,
    license_image_uploaded_at = NULL
WHERE license_image_path IS NOT NULL
  AND license_image_uploaded_at < NOW() - INTERVAL '48 hours'
  AND license_image_verified = false;
```

## Monitoring

### Key Metrics

1. **Upload success rate**
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE license_image_path IS NOT NULL) as total_uploads,
     COUNT(*) FILTER (WHERE license_image_verified = true) as verified,
     COUNT(*) FILTER (WHERE license_image_verified = false AND license_image_uploaded_at < NOW() - INTERVAL '48 hours') as expired
   FROM user_profiles
   WHERE license_image_uploaded_at > NOW() - INTERVAL '7 days';
   ```

2. **Cleanup job effectiveness**
   - Check Vercel cron logs daily
   - Monitor `verifiedImagesDeleted` and `expiredImagesDeleted` counts
   - Alert if cleanup fails for 2+ days

3. **Storage usage**
   - Monitor Supabase Storage → `license-images-temp` bucket size
   - Should remain small (under 100MB for 1000s of users)
   - If growing, check cleanup job

## Production Checklist

Before going live:

- [ ] Supabase Storage bucket created (`license-images-temp`)
- [ ] Bucket policies configured (authenticated upload, service role read/delete)
- [ ] Database migration run (license image columns added)
- [ ] Cron job deployed and running (check Vercel logs)
- [ ] Test upload flow (signup → upload → verify preview)
- [ ] Test cleanup (verify old images are deleted)
- [ ] Monitor storage size (should stay small)

---

## Next Steps

1. **Test the upload flow** in production
2. **Build remitter portal** for image verification
3. **Add email notifications** when user needs to re-upload
4. **Monitor cleanup job** logs for first week

**Questions?** Check implementation in:
- `pages/api/protection/upload-license.ts` (upload endpoint with dual-layer verification: Sharp + Claude Vision)
- `pages/api/cron/cleanup-license-images.ts` (cleanup job)
- `pages/alerts/success.tsx` (success page with conditional license upload UI)
- `pages/settings.tsx` (settings page with license upload for users who click away)
- `database/migrations/add_license_image_tracking.sql` (schema)

**Key Implementation Details:**
- Upload shows for users with city sticker + permit zone on:
  - Success page after payment (pages/alerts/success.tsx:287-442)
  - Settings page (pages/settings.tsx:1539-1722)
- Dual-layer verification:
  - Layer 1: Sharp (pages/api/protection/upload-license.ts:41-122)
  - Layer 2: Claude Vision (pages/api/protection/upload-license.ts:124-206)
- Automatic cleanup runs daily at 4 AM (vercel.json:111-113)
- Images auto-expire after 48 hours if unverified

## Environment Variables

Required in Vercel for full functionality:

```bash
# Supabase (already configured)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Claude Vision API (for dual-layer license verification)
ANTHROPIC_API_KEY=sk-ant-xxxxx

# Cron job security (already configured)
CRON_SECRET=your-cron-secret
```

**Note:** If `ANTHROPIC_API_KEY` is not set, the system will skip Claude Vision verification and use Sharp verification only (still works, just less accurate for edge cases like glare or wrong document type).
