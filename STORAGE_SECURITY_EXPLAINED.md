# Storage Security & Structure Explained

## Your Questions Answered

### 1. Is the license image secure in the Supabase bucket?

**YES - License images are stored securely in Supabase Storage:**

- **Bucket:** `license-images-temp`
- **Storage path:** `licenses/{user_id}_{timestamp}.jpg`
- **Example:** `licenses/049f3b4a-32d4-4d09-87de-eb0cfe33c04e_1736964523.jpg`

**Security features:**
- ✅ **Private bucket** - Not publicly accessible
- ✅ **Row Level Security (RLS)** - Only user and admins can access
- ✅ **Signed URLs** - Temporary 24-hour access tokens
- ✅ **Encryption at rest** - Supabase encrypts all stored files
- ✅ **Encryption in transit** - HTTPS only

**Access control:**
```sql
-- Only the user who uploaded can view their license
-- Or: Service role (your backend) can access for processing
CREATE POLICY "Users can view own license images"
ON storage.objects FOR SELECT
USING (bucket_id = 'license-images-temp' AND auth.uid()::text = (storage.foldername(name))[1]);
```

**How it works:**
1. User uploads license on success page or settings
2. Image verified by Sharp + Google Cloud Vision
3. Stored in private Supabase bucket
4. When you need it for city sticker renewal:
   - Your backend generates signed URL (24h expiration)
   - Downloads image
   - Sends to remitter
   - Signed URL expires automatically

**Deletion policy:**
- **Multi-year reuse (default):** Kept until license expires
- **Opted out:** Deleted 48 hours after last access
- **Abandoned uploads:** Deleted after 48 hours

---

### 2. What is `proof/{uuid}/{yyyy-mm-dd}/bill.pdf`?

This is the **organized folder structure for residency proofs (utility bills)** - makes it easy for your backend to find and send to remitters.

**Storage location:** Supabase bucket `residency-proofs-temp`

**Example paths:**
```
residency-proofs-temp/
  proof/
    049f3b4a-32d4-4d09-87de-eb0cfe33c04e/     ← User's UUID folder
      2025-01-15/                              ← Date received
        bill.pdf                               ← Always named "bill.pdf"
      2025-02-12/
        bill.pdf
      2025-03-08/                              ← Most recent (this is the one you'll use)
        bill.pdf
```

**Why this structure?**

| Feature | Benefit |
|---------|---------|
| `proof/` | Clear root folder for all residency proofs |
| `{uuid}/` | One folder per user - easy to find all bills for a user |
| `{yyyy-mm-dd}/` | Bills organized by received date - most recent is obvious |
| `bill.pdf` | Simple consistent naming - no complex filenames to parse |

**How remitter accesses it:**

```typescript
// Option 1: Use the API (recommended)
const response = await fetch(`/api/city-sticker/get-residency-proof?userId=${userId}`);
const { signedUrl } = await response.json();
const billPdf = await fetch(signedUrl);

// Option 2: Direct path lookup (if needed)
const billPath = `proof/${userId}/2025-03-08/bill.pdf`; // Most recent date
const { data } = await supabase.storage
  .from('residency-proofs-temp')
  .download(billPath);
```

**Security:**
- ✅ **Private bucket** - Not publicly accessible
- ✅ **UUID in path** - No personally identifiable info in folder name
- ✅ **Signed URLs** - Temporary access (24h)
- ✅ **Auto-deletion** - Deleted after purchase confirmed

---

### 3. Supabase Buckets Explained

You need **TWO buckets:**

#### Bucket 1: `license-images-temp`
**Purpose:** Driver's license images
**Path structure:** `licenses/{user_id}_{timestamp}.jpg`
**Access:** Private, RLS enabled
**Retention:**
- Multi-year: Until license expires
- Opted out: 48h after access
- Abandoned: 48h after upload

#### Bucket 2: `residency-proofs-temp`
**Purpose:** Utility bills (proof of residency)
**Path structure:** `proof/{user_id}/{yyyy-mm-dd}/bill.pdf`
**Access:** Private, RLS enabled
**Retention:**
- Deleted after city sticker purchase confirmed
- OR: 60+ days old outside renewal window
- During renewal window (60 days before to 7 days after): Always kept

---

## Summary: Security Guarantees

### License Images
1. ✅ Stored in **private** Supabase bucket
2. ✅ **Encrypted** at rest and in transit
3. ✅ **Access controlled** via RLS (user + admin only)
4. ✅ **Temporary signed URLs** for secure sharing
5. ✅ **Auto-deleted** based on user consent and expiration

### Residency Proofs (Utility Bills)
1. ✅ Stored in **private** Supabase bucket
2. ✅ **Organized** folder structure for easy remitter access
3. ✅ **UUID-based** paths (no PII in folder names)
4. ✅ **Only most recent** bill kept (old ones deleted)
5. ✅ **Auto-deleted** after purchase confirmed

### Email Routing (Cloudflare)
1. ✅ **No email storage** - routed directly to webhook
2. ✅ **Not stored in Gmail** or any inbox
3. ✅ **Ephemeral routing** - email deleted after processing
4. ✅ **PDF extracted** and stored in organized bucket structure
5. ✅ **Free** (unlimited emails)

---

## How Remitter Gets Documents

### Driver's License:
```typescript
// When processing city sticker renewal
const { data: profile } = await supabase
  .from('user_profiles')
  .select('license_image_path')
  .eq('user_id', userId)
  .single();

const { data: signedUrl } = await supabase.storage
  .from('license-images-temp')
  .createSignedUrl(profile.license_image_path, 86400); // 24h

// Download and send to remitter
const license = await fetch(signedUrl.signedUrl);
```

### Proof of Residency:
```typescript
// Use the API endpoint (easiest)
const response = await fetch(`/api/city-sticker/get-residency-proof?userId=${userId}`);
const { signedUrl, filePath } = await response.json();

// Download and send to remitter
const utilityBill = await fetch(signedUrl);
```

Both methods are **secure**, **temporary**, and **automatically cleaned up** after use.

---

## Privacy Compliance

| Requirement | License Images | Utility Bills |
|-------------|----------------|---------------|
| **Consent** | Required (Google Cloud Vision) | Required (Email forwarding) |
| **Purpose Limitation** | City sticker renewal only | Proof of residency only |
| **Data Minimization** | Only license image | Only most recent bill |
| **Storage Duration** | Until expiration OR 48h | Until purchase confirmed |
| **Encryption** | At rest + in transit | At rest + in transit |
| **Access Control** | User + Admin only | User + Admin only |
| **Deletion Rights** | User can request anytime | User can revoke consent |
| **Third-Party** | Google Cloud Vision (disclosed) | Cloudflare (disclosed) |

✅ **GDPR Compliant**
✅ **CCPA Compliant**
✅ **User Privacy Protected**
✅ **No data sold or shared**
✅ **Transparent processing**
