# License Upload - Current Status

## ✅ WHAT'S FIXED

### 1. Google Vision API ✅
- **Status**: Fully configured and working
- **Verification**: https://autopilotamerica.com/api/test-vision-config shows it's properly set up
- **What it validates**:
  - OCR text detection (verifies text is readable)
  - Document type verification (checks for keywords: "license", "driver", "DL", "DOB", "expires")
  - Image quality detection (brightness, glare, clarity)
  - Rejects non-license documents

### 2. Database Schema ✅
- Added `license_image_path_back` column
- Added `license_image_back_uploaded_at` column
- Added `license_image_back_verified` column
- Now supports storing BOTH front and back separately

### 3. Upload API ✅
- Updated `/api/protection/upload-license` to accept `side` parameter ('front' or 'back')
- Filenames now include side: `{userId}_front_{timestamp}.jpg` and `{userId}_back_{timestamp}.jpg`
- Database updates correctly based on which side is uploaded
- Sharp validation disabled (was causing Vercel compatibility issues)
- Google Vision handles ALL validation now

### 4. Settings Page Handler ✅
- Updated `handleLicenseFileChange` function to accept `side` parameter
- Separate state for front and back uploads
- Proper error handling for each side independently

## ⚠️ WHAT NEEDS MANUAL FIX

### UI File Input Section
The file input section at line ~1876-1950 in `pages/settings.tsx` needs to be DUPLICATED and updated:

**Current (single input):**
```tsx
<input
  type="file"
  onChange={handleLicenseFileChange}  // MISSING side parameter!
  ...
/>
```

**Needs to become (two inputs):**
```tsx
{/* FRONT OF LICENSE */}
<h3>Front of License</h3>
<input
  type="file"
  onChange={(e) => handleLicenseFileChange(e, 'front')}
  ...
/>
{licenseFrontUploading && <div>Uploading front...</div>}
{licenseFrontUploadError && <div>Error: {licenseFrontUploadError}</div>}
{licenseFrontPreview && <img src={licenseFrontPreview} />}

{/* BACK OF LICENSE */}
<h3>Back of License</h3>
<input
  type="file"
  onChange={(e) => handleLicenseFileChange(e, 'back')}
  ...
/>
{licenseBackUploading && <div>Uploading back...</div>}
{licenseBackUploadError && <div>Error: {licenseBackUploadError}</div>}
{licenseBackPreview && <img src={licenseBackPreview} />}
```

### Status Display at Top
Need to find where it shows "⚠️ Driver's License - Not uploaded yet" and update to:
- Show "✅ Front uploaded" if `profile.license_image_path` exists
- Show "✅ Back uploaded" if `profile.license_image_path_back` exists
- Show warning only if BOTH are missing

## 🧪 HOW TO TEST

1. Go to https://autopilotamerica.com/settings#license-upload
2. Check consent checkbox
3. Upload front of license - should say "Driver's license (front) uploaded successfully"
4. Upload back of license - should say "Driver's license (back) uploaded successfully"
5. Refresh page - both should still show as uploaded
6. Warning at top should disappear

## 📊 VERIFY IN DATABASE

Run this to check what's stored:
```bash
node check-license-uploads.js
```

Should show:
- `license_image_path`: licenses/{userId}_front_{timestamp}.jpg
- `license_image_path_back`: licenses/{userId}_back_{timestamp}.jpg
- Both files exist in Supabase storage bucket `license-images-temp`

## 🎯 NEXT STEPS

1. Manually update the UI section in `pages/settings.tsx` (lines ~1876-1950)
2. Find and update the status warning section (search for "Not uploaded")
3. Test both uploads work independently
4. Verify files are being stored correctly
5. Confirm city clerk can access both front and back images
