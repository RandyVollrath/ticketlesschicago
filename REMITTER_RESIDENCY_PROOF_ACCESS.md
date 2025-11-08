# Remitter Access to Residency Proofs

## Summary

How remitters can easily retrieve proof of residency (utility bills) for city sticker renewals.

---

## Storage Structure

All utility bills are stored in an organized folder structure:

```
residency-proofs-temp/
  proof/
    {user-uuid}/
      2025-01-15/
        bill.pdf
      2025-02-12/
        bill.pdf
      2025-03-08/
        bill.pdf (most recent)
```

**Example:**
```
residency-proofs-temp/proof/049f3b4a-32d4-4d09-87de-eb0cfe33c04e/2025-03-08/bill.pdf
```

### Why This Structure?

1. **Easy to navigate**: Each user has their own folder
2. **Date-organized**: Bills sorted by received date
3. **Simple file name**: Always `bill.pdf` (no complex naming)
4. **Remitter-friendly**: Path includes user UUID for easy lookup
5. **Most recent is clear**: Latest date folder = most recent bill

---

## API Access for Remitters

### GET /api/city-sticker/get-residency-proof

Retrieves the most recent utility bill for a user.

**Request:**
```bash
GET /api/city-sticker/get-residency-proof?userId=049f3b4a-32d4-4d09-87de-eb0cfe33c04e
```

**Response:**
```json
{
  "success": true,
  "signedUrl": "https://storage.supabase.co/...?token=...",
  "uploadedAt": "2025-03-08T14:23:45.123Z",
  "expiresAt": "2025-03-09T14:23:45.123Z",
  "filePath": "proof/049f3b4a-32d4-4d09-87de-eb0cfe33c04e/2025-03-08/bill.pdf",
  "message": "Download URL valid for 24 hours"
}
```

**Error Cases:**

1. **No proof on file:**
```json
{
  "error": "No residency proof on file",
  "message": "User has not uploaded or forwarded a utility bill"
}
```

2. **User doesn't have permit zone:**
```json
{
  "error": "User does not have permit zone - proof of residency not required"
}
```

3. **Proof not verified:**
```json
{
  "error": "Residency proof not verified",
  "message": "Bill has not been validated yet"
}
```

---

## Integration Example

### City Sticker Renewal Automation

```typescript
// In your city sticker renewal process
async function renewCitySticker(userId: string) {
  // 1. Get user profile to check if they need proof of residency
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('has_permit_zone, address, license_plate')
    .eq('user_id', userId)
    .single();

  if (!profile.has_permit_zone) {
    // No proof needed - proceed with regular renewal
    return await submitRenewalWithoutProof(userId);
  }

  // 2. Get residency proof
  const proofResponse = await fetch(
    `/api/city-sticker/get-residency-proof?userId=${userId}`
  );

  if (!proofResponse.ok) {
    const error = await proofResponse.json();
    console.error('No residency proof available:', error);

    // Send email to user requesting they upload/forward a bill
    await notifyUserToUploadBill(userId);
    return { error: 'Missing residency proof' };
  }

  const { signedUrl, filePath } = await proofResponse.json();

  // 3. Download the bill PDF
  const billResponse = await fetch(signedUrl);
  const billBuffer = await billResponse.arrayBuffer();

  // 4. Submit to remitter with proof attached
  const formData = new FormData();
  formData.append('address', profile.address);
  formData.append('licensePlate', profile.license_plate);
  formData.append('residencyProof', new Blob([billBuffer], { type: 'application/pdf' }), 'utility_bill.pdf');

  const remitterResponse = await fetch('https://remitter.example.com/city-sticker', {
    method: 'POST',
    body: formData,
  });

  return await remitterResponse.json();
}
```

---

## Direct Storage Access (If Needed)

If you need to access the files directly via Supabase Storage:

### Get Most Recent Bill for User

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function getMostRecentBill(userId: string) {
  // List all folders for this user
  const { data: folders, error } = await supabase.storage
    .from('residency-proofs-temp')
    .list(`proof/${userId}`);

  if (error || !folders || folders.length === 0) {
    throw new Error('No bills found for user');
  }

  // Sort by date (folder names are yyyy-mm-dd)
  const sortedFolders = folders
    .filter(f => f.name.match(/^\d{4}-\d{2}-\d{2}$/)) // Match yyyy-mm-dd format
    .sort((a, b) => b.name.localeCompare(a.name)); // Descending order

  const mostRecentDate = sortedFolders[0].name;
  const billPath = `proof/${userId}/${mostRecentDate}/bill.pdf`;

  // Download the bill
  const { data: billData, error: downloadError } = await supabase.storage
    .from('residency-proofs-temp')
    .download(billPath);

  if (downloadError) {
    throw new Error(`Failed to download bill: ${downloadError.message}`);
  }

  return {
    billData,
    uploadedDate: mostRecentDate,
    filePath: billPath,
  };
}
```

---

## Cleanup Behavior

**Important:** Residency proofs are ephemeral and will be deleted after:

1. **Successful city sticker purchase confirmed** (`city_sticker_purchase_confirmed_at` is set)
2. **60 days outside renewal window** (if no purchase confirmed)

**During renewal window** (60 days before sticker expiry to 7 days after renewal submission):
- Bills are kept even if older than 60 days
- Allows time for processing and potential resubmission

**Best practice:**
- Download and attach proof to remitter submission immediately
- Don't rely on the proof being available indefinitely
- If remitter submission fails, proof will still be available for retry within renewal window

---

## Tracking Access

Every time you call `/api/city-sticker/get-residency-proof`, the system updates:
```sql
UPDATE user_profiles
SET license_last_accessed_at = NOW()
WHERE user_id = '...';
```

This tracks when proofs were last accessed for the 48-hour deletion window (for users who opt out of multi-year storage).

---

## Example Workflow

1. **User forwards bill:** `documents+{uuid}@autopilotamerica.com`
2. **System stores:** `proof/{uuid}/2025-03-08/bill.pdf`
3. **30 days before sticker expiry:** Your renewal cron runs
4. **Renewal process calls:** `GET /api/city-sticker/get-residency-proof?userId={uuid}`
5. **System returns:** Signed URL valid for 24 hours
6. **Remitter downloads:** PDF from signed URL
7. **Remitter submits:** City sticker application with proof attached
8. **After confirmation:** System deletes bill from storage

---

## Benefits of This Approach

✅ **Simple paths:** Easy to understand and navigate
✅ **Date organized:** Clear which bill is most recent
✅ **API abstraction:** Don't need to know storage internals
✅ **Secure access:** Signed URLs with expiration
✅ **Ephemeral storage:** Automatic cleanup after use
✅ **Renewal window protection:** Bills kept during active renewal period
✅ **Error handling:** Clear error messages when proof missing

---

## Questions?

- **What if user has multiple bills?** Only most recent date folder matters - always use latest
- **What if bill.pdf doesn't exist?** API returns 404 with clear error message
- **What if user uploads manually?** Same folder structure, same API access
- **What if we need older bills?** Only keep most recent - older bills deleted when new one arrives
- **What about validation?** Only verified bills (`residency_proof_verified = true`) are accessible via API
