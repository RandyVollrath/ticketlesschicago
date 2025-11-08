# ⚠️ CRITICAL INSTRUCTIONS FOR REMITTER

## License Access Warning

**IMPORTANT:** Driver's licenses have a 48-hour deletion timer that starts when you access them.

### The Problem:
- Users can opt OUT of multi-year license storage
- For these users, licenses are deleted **48 hours AFTER last access**
- If you access a license for testing/preview, the deletion countdown starts
- License could be deleted before actual city submission!

### The Solution:
**ONLY access driver's licenses when ACTIVELY SUBMITTING to the city.**

Do NOT:
- ❌ Access for preview
- ❌ Access for testing
- ❌ Access days before submission
- ❌ Access multiple times for same renewal

Do:
- ✅ Access ONLY when ready to submit to city immediately
- ✅ Download once, submit once
- ✅ Complete submission within 24 hours

---

## API Endpoints for Document Access

### 1. Get Driver's License
**Endpoint:** `GET /api/city-sticker/get-driver-license?userId={uuid}`

**⚠️ WARNING:** This updates `license_last_accessed_at` timestamp!

**When to call:** ONLY when actively submitting to city (within 24 hours of submission)

**Response:**
```json
{
  "success": true,
  "signedUrl": "https://storage.supabase.co/...?token=...",
  "uploadedAt": "2025-03-01T14:23:45.123Z",
  "expiresAt": "2025-03-02T14:23:45.123Z",
  "filePath": "licenses/049f3b4a_1736964523.jpg",
  "licenseValidUntil": "2029-12-15",
  "multiYearConsent": false,
  "warning": "⚠️ License will be deleted 48 hours after this access",
  "message": "Download URL valid for 24 hours. ONLY access when submitting to city!"
}
```

**Deletion policy based on `multiYearConsent`:**
- `true`: License kept until `licenseValidUntil` date (safe to access anytime)
- `false`: License deleted 48 hours after `license_last_accessed_at` (⚠️ BE CAREFUL!)

### 2. Get Proof of Residency (Utility Bill)
**Endpoint:** `GET /api/city-sticker/get-residency-proof?userId={uuid}`

**Safe to call anytime** - No deletion timer triggered.

**Why it's safe:**
- Bills auto-deleted after 30 days regardless
- User forwards new bill monthly
- No access-based deletion

**Response:**
```json
{
  "success": true,
  "signedUrl": "https://storage.supabase.co/...?token=...",
  "uploadedAt": "2025-03-08T10:15:32.456Z",
  "expiresAt": "2025-03-09T10:15:32.456Z",
  "filePath": "proof/049f3b4a.../2025-03-08/bill.pdf",
  "message": "Download URL valid for 24 hours"
}
```

---

## Recommended Workflow

### Option A: Pre-check Documents (Recommended)
```typescript
// 1. Check if documents exist (no deletion timer)
const checkResponse = await fetch(`/api/user-profile?userId=${userId}`);
const { hasLicense, hasBill } = await checkResponse.json();

if (!hasLicense || !hasBill) {
  // Alert user to upload missing docs
  return;
}

// 2. When ready to submit (within minutes):
const [licenseRes, billRes] = await Promise.all([
  fetch(`/api/city-sticker/get-driver-license?userId=${userId}`),  // ⚠️ Starts timer!
  fetch(`/api/city-sticker/get-residency-proof?userId=${userId}`)
]);

const { signedUrl: licenseUrl } = await licenseRes.json();
const { signedUrl: billUrl } = await billRes.json();

// 3. Download immediately
const [licensePdf, billPdf] = await Promise.all([
  fetch(licenseUrl).then(r => r.blob()),
  fetch(billUrl).then(r => r.blob())
]);

// 4. Submit to city IMMEDIATELY
await submitToCityPortal(userId, licensePdf, billPdf);
```

### Option B: Check Multi-Year Consent First
```typescript
// 1. Get user profile to check license consent
const profileRes = await fetch(`/api/user-profile?userId=${userId}`);
const { license_reuse_consent_given } = await profileRes.json();

if (license_reuse_consent_given) {
  // Safe to access anytime - no deletion timer
  console.log('✅ Multi-year consent: Safe to access license');
} else {
  // Deletion timer will start on access!
  console.warn('⚠️ NO multi-year consent: Only access when submitting!');
}

// 2. Access documents ONLY when ready
// ...
```

---

## Document Deletion Policies

### Driver's Licenses

| User Consent | Storage Duration | Deletion Trigger |
|--------------|------------------|------------------|
| **Multi-year (DEFAULT)** | Until license expires | License expiration date |
| **Opted OUT** | 48 hours after access | `license_last_accessed_at + 48h` |
| **Unverified upload** | 48 hours | Upload date + 48h |

### Utility Bills

| Scenario | Deletion |
|----------|----------|
| **Normal** | 30 days after upload |
| **New bill arrives** | Old bill deleted immediately |

**No deletion based on access** - Safe to check anytime

---

## Error Handling

### Driver's License Errors

**404 - No license on file:**
```json
{
  "error": "No driver's license on file",
  "message": "User has not uploaded their driver's license"
}
```
**Action:** Notify user to upload at `/settings#license-upload`

**Gone (if already deleted):**
- File was deleted due to 48h timer expiring
- User opted out of multi-year storage
- You accessed too early, submission took >48h
**Action:** Request user to re-upload license

### Utility Bill Errors

**404 - No bill on file:**
```json
{
  "error": "No residency proof on file",
  "message": "User has not uploaded or forwarded a utility bill"
}
```
**Action:** Notify user to forward bills to `documents+{uuid}@autopilotamerica.com`

---

## Testing Recommendations

### DO NOT test with real user licenses that have `multiYearConsent: false`!

**Safe testing:**
1. Create test user
2. Upload test license
3. **Check `multiYearConsent` in database**
4. If `false`, either:
   - Set to `true` for testing
   - OR: Only test full submission flow (access → submit within 24h)

**Unsafe testing:**
```typescript
// ❌ BAD: Testing days before submission
const { signedUrl } = await fetch('/api/city-sticker/get-driver-license?userId=test');
// Timer started! If you submit 3 days later, license might be deleted!

// ❌ BAD: Accessing multiple times
for (let i = 0; i < 5; i++) {
  await fetch('/api/city-sticker/get-driver-license?userId=test'); // Resets timer each time
}
```

**Safe testing:**
```typescript
// ✅ GOOD: Check consent first
const profile = await getProfile(userId);
if (!profile.license_reuse_consent_given) {
  console.warn('⚠️ Testing with opted-out user - be careful!');
}

// ✅ GOOD: Complete flow immediately
const docs = await getDocuments(userId); // ⚠️ Timer starts
await submitToCity(docs); // Complete within 24h
```

---

## Summary

| Document | Access Triggers Deletion? | Safe to Preview? | Notes |
|----------|---------------------------|------------------|-------|
| **Driver's License** | ⚠️ YES (if opted out) | NO | ONLY access when submitting |
| **Utility Bill** | ✅ NO | YES | Auto-deleted after 30 days |

**Key Takeaway:**
- **Utility bills:** Access anytime, no worries
- **Driver's licenses:** Access ONLY when actively submitting to city (within 24 hours)

**Most users have multi-year consent:** Most licenses are safe to access anytime.
**Always check `multiYearConsent` first** to know if deletion timer applies.
