# Driver's License Upload & Deletion Flow Audit Report

## Summary
**CRITICAL ISSUE FOUND**: Database schema mismatch - back license fields are being used in code but are NOT defined in database migrations.

---

## 1. UPLOAD ENDPOINT ANALYSIS
**File**: `/pages/api/protection/upload-license.ts` (Lines 363-373)

### Fields Set for FRONT License:
```typescript
{
  license_image_path: filePath,
  license_image_uploaded_at: new Date().toISOString(),
  license_image_verified: false,
}
```

### Fields Set for BACK License:
```typescript
{
  license_image_path_back: filePath,           // ⚠️ NOT IN DATABASE SCHEMA
  license_image_back_uploaded_at: new Date(),   // ⚠️ NOT IN DATABASE SCHEMA
  license_image_back_verified: false,           // ⚠️ NOT IN DATABASE SCHEMA
}
```

---

## 2. CLEANUP CRON ANALYSIS
**File**: `/pages/api/cron/cleanup-license-images.ts`

### What It Checks:
The cleanup cron ONLY checks **front license fields**:
- Queries: `license_image_path`, `license_image_uploaded_at`, `license_image_verified`
- Updates: `license_image_path`, `license_image_uploaded_at`

### Key Operations:

**Category 1: Opted-Out Users (Lines 51-107)**
```
SELECT: license_image_path, license_last_accessed_at, license_image_uploaded_at
UPDATE: license_image_path = null, license_image_uploaded_at = null
```

**Category 2: Abandoned Uploads (Lines 111-163)**
```
SELECT: license_image_path (ONLY - no back license)
WHERE: license_image_verified = false AND license_image_uploaded_at < 48h
UPDATE: license_image_path = null, license_image_uploaded_at = null
```

**RESULT**: The cleanup cron does NOT handle `license_image_path_back` at all.

---

## 3. DATABASE SCHEMA CHECK
**Source**: `/database/migrations/add_license_image_tracking.sql`

### Defined Columns:
✅ license_image_path
✅ license_image_uploaded_at
✅ license_image_verified
✅ license_image_verified_at
✅ license_image_verified_by
✅ license_image_verification_notes

### Missing Columns (Used in Code):
❌ license_image_path_back
❌ license_image_back_uploaded_at
❌ license_image_back_verified

Other relevant fields:
✅ license_reuse_consent_given (in add_license_reuse_consent.sql)
✅ license_last_accessed_at (in add_license_reuse_consent.sql)

---

## 4. FIELD NAME CONSISTENCY ANALYSIS

### Upload Endpoint Usage:
| Side  | Path Field              | Uploaded At              | Verified Field      |
|-------|------------------------|--------------------------|---------------------|
| FRONT | license_image_path     | license_image_uploaded_at | license_image_verified |
| BACK  | license_image_path_back | license_image_back_uploaded_at | license_image_back_verified |

### Cleanup Cron Checks:
| Scenario | Fields Checked | Fields Updated |
|----------|----------------|-----------------|
| Opted-Out | license_image_path only | license_image_path |
| Abandoned | license_image_path only | license_image_path |
| (Back) | ❌ NONE | ❌ NONE |

### View Endpoint (`view-license.ts`):
```typescript
.select('license_image_path, license_image_path_back')
```
✓ Can read back path (if it existed in DB)

---

## 5. CRITICAL ISSUES IDENTIFIED

### Issue #1: Missing Database Columns
**Severity**: CRITICAL

The following columns are used in `/pages/api/protection/upload-license.ts` but are NOT defined in any migration file:
- `license_image_path_back`
- `license_image_back_uploaded_at`
- `license_image_back_verified`

**Impact**: 
- Uploaded back license data silently fails to save (no error thrown)
- Users may think their back license is uploaded, but the database rejects the write
- Back licenses are NEVER stored

**Fix Required**: Create migration to add these columns

---

### Issue #2: Cleanup Cron Ignores Back Licenses
**Severity**: CRITICAL (if back licenses ever exist)

The cleanup cron job (`cleanup-license-images.ts`) never queries or deletes back license images:
- Only checks `license_image_path` (FRONT)
- Never checks `license_image_path_back` (BACK)
- Back licenses would accumulate indefinitely in storage

**Impact**: 
- Even if back licenses are properly stored, they're never cleaned up
- Storage costs increase indefinitely
- Privacy risk: old back licenses persist forever

**Fix Required**: Extend cleanup cron to handle back licenses

---

### Issue #3: Upload Endpoint Sets Unverified Fields
**Severity**: MEDIUM

The upload endpoint sets `license_image_back_verified = false` for back uploads, but the cleanup cron queries `license_image_verified` (FRONT field) when checking abandoned uploads.

**Current Logic (Line 114)**:
```typescript
.eq('license_image_verified', false)  // Only checks FRONT
```

Should also check: `license_image_back_verified` (doesn't exist yet)

---

## 6. SIDE-BY-SIDE COMPARISON

### What Gets Uploaded (upload-license.ts):
```
FRONT: {
  license_image_path
  license_image_uploaded_at
  license_image_verified
}

BACK: {
  license_image_path_back          ⚠️ NO DB COLUMN
  license_image_back_uploaded_at   ⚠️ NO DB COLUMN
  license_image_back_verified      ⚠️ NO DB COLUMN
}
```

### What Gets Cleaned Up (cleanup-license-images.ts):
```
FRONT OPTED-OUT:
  SELECT: license_image_path, license_last_accessed_at, license_image_uploaded_at
  DELETE: FROM STORAGE + license_image_path

FRONT ABANDONED:
  SELECT: license_image_path, license_image_verified (48h+)
  DELETE: FROM STORAGE + license_image_path

BACK: ❌ NOT HANDLED AT ALL
```

### What Gets Queried for View (view-license.ts):
```
SELECT: license_image_path, license_image_path_back
(can view either side)
```

---

## 7. RELATED FIELDS (CORRECTLY IMPLEMENTED)

These fields ARE properly defined and used consistently:

✅ **license_reuse_consent_given**
- Defined in: `add_license_reuse_consent.sql`
- Checked in: `cleanup-license-images.ts` (Line 54)
- Matches! ✓

✅ **license_last_accessed_at**
- Defined in: `add_license_reuse_consent.sql`
- Checked in: `cleanup-license-images.ts` (Line 67)
- Updated in: `get-driver-license.ts` (Line 82)
- Matches! ✓

---

## 8. RECOMMENDATIONS

### Immediate Actions (CRITICAL):
1. **Create migration** to add missing back license columns:
   ```sql
   ALTER TABLE user_profiles
   ADD COLUMN license_image_path_back TEXT,
   ADD COLUMN license_image_back_uploaded_at TIMESTAMPTZ,
   ADD COLUMN license_image_back_verified BOOLEAN DEFAULT false;
   ```

2. **Update cleanup cron** to handle back licenses:
   - Query both `license_image_path` AND `license_image_path_back`
   - Check both `license_image_verified` AND `license_image_back_verified`
   - Delete both paths from storage
   - Clear both path fields from database

3. **Create indexes** for back license cleanup queries:
   ```sql
   CREATE INDEX idx_license_image_back_cleanup
   ON user_profiles(license_image_back_uploaded_at)
   WHERE license_image_path_back IS NOT NULL;
   ```

### Testing Required:
- [ ] Upload front license → verify stored in `license_image_path`
- [ ] Upload back license → verify stored in `license_image_path_back`
- [ ] Wait 48h → verify cron deletes both
- [ ] Cleanup job logs show both front and back deletion
- [ ] View endpoint can retrieve both sides

---

## 9. FIELD SUMMARY TABLE

| Field Name | Upload Uses | Cleanup Checks | Cleanup Deletes | View Queries | DB Migration |
|------------|------------|----------------|-----------------|--------------|--------------|
| license_image_path | ✅ Front | ✅ Yes | ✅ Yes | ✅ Yes | ✅ Yes |
| license_image_uploaded_at | ✅ Front | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| license_image_verified | ✅ Front | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| license_image_path_back | ✅ Back | ❌ NO | ❌ NO | ✅ Yes | ❌ NO |
| license_image_back_uploaded_at | ✅ Back | ❌ NO | ❌ NO | ❌ No | ❌ NO |
| license_image_back_verified | ✅ Back | ❌ NO | ❌ NO | ❌ No | ❌ NO |
| license_last_accessed_at | ❌ No | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |
| license_reuse_consent_given | ❌ No | ✅ Yes | ✅ Yes | ❌ No | ✅ Yes |

---

## Conclusion

The driver's license upload and deletion flow has a **critical schema mismatch**. Back license fields are referenced in the upload endpoint and view endpoint, but the database columns don't exist and the cleanup cron ignores them entirely. This creates a broken flow where:

1. Back license uploads silently fail (no DB columns)
2. View endpoint tries to query non-existent columns
3. Cleanup cron never deletes back licenses (if they somehow get created)

**Action Required**: Implement all three recommended fixes before any back license functionality works.
