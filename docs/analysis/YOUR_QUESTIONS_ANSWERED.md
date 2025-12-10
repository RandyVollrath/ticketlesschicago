# Your Questions Answered

## 1. Is the utility bill going from email address to Supabase storage bucket automatically?

**YES!** Here's exactly how it works:

```
User's Utility Provider (Comcast)
    ↓ (forwards monthly bill)
documents+{user-uuid}@autopilotamerica.com
    ↓ (Cloudflare Email Routing)
Webhook: /api/email/process-residency-proof
    ↓ (extracts PDF attachment)
Supabase Storage: residency-proofs-temp/proof/{uuid}/{yyyy-mm-dd}/bill.pdf
    ↓ (auto-deletes old bills)
Database: residency_proof_path = "proof/{uuid}/2025-03-08/bill.pdf"
```

**What happens automatically:**
1. ✅ Email received at Cloudflare
2. ✅ Routed to your webhook
3. ✅ PDF extracted from attachment
4. ✅ **ALL previous bills deleted**
5. ✅ New bill stored in organized folder
6. ✅ Database updated with new path
7. ✅ Email deleted (never stored anywhere)

**User forwards all bills monthly → You always have most recent → Old ones auto-deleted**

---

## 2. License deletes after 48 hours it was accessed - Remitter communication

**YES - You're correct!** This is a critical point for the remitter.

### The Issue:
- Users who **opt OUT** of multi-year storage → License deletes 48h after `license_last_accessed_at`
- Most users have **multi-year enabled by DEFAULT** → License kept until expires (safe)
- Remitter needs to know: **ONLY access when actively submitting**

### When License is Accessed:
```typescript
// Remitter calls this endpoint:
GET /api/city-sticker/get-driver-license?userId={uuid}

// This updates database:
UPDATE user_profiles
SET license_last_accessed_at = NOW()
WHERE user_id = '{uuid}';

// For opted-out users: Deletion cron runs daily and deletes if:
// license_last_accessed_at < (NOW() - 48 hours)
```

### Remitter Instructions (See REMITTER_CRITICAL_INSTRUCTIONS.md):

**DO:**
- ✅ Access license ONLY when ready to submit to city immediately
- ✅ Complete submission within 24 hours of accessing
- ✅ Check `multiYearConsent` field first (if true, safe to access anytime)

**DON'T:**
- ❌ Access for preview/testing days before submission
- ❌ Access multiple times for same renewal
- ❌ Access then wait 3+ days to submit (license might be deleted!)

**Most users are safe:** Default is multi-year consent = true, so license kept until expiry.

**For opted-out users:** Remitter must be careful to only access when submitting.

---

## 3. Can we just delete utility bills every 30 days?

**YES - That's exactly what I implemented!**

### Previous (complicated):
- Wait for city sticker purchase confirmation
- Check renewal windows
- Complex logic with multiple deletion scenarios

### Current (simple):
```typescript
// Cron job runs daily at 2 AM
// Deletes ALL bills older than 30 days

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const oldBills = await supabase
  .from('user_profiles')
  .select('residency_proof_path')
  .lt('residency_proof_uploaded_at', thirtyDaysAgo);

// Delete all old bills
for (const bill of oldBills) {
  await supabase.storage.from('residency-proofs-temp').remove([bill.path]);
}
```

### Why it works:
- ✅ User forwards bills monthly
- ✅ New bill arrives → Old bill replaced immediately by email parser
- ✅ Bills older than 30 days → Deleted by cron
- ✅ Always have recent bill (within 30 days)
- ✅ No need to wait for remitter confirmation

**Simple policy:** Bills older than 30 days = deleted.

---

## 4. How do we handle driver's license expiration notifications?

**60+ days before CITY STICKER RENEWAL, not license expiry.**

### The Logic:
```typescript
// Find users with city sticker renewal in next 90 days
const profiles = await supabase
  .from('user_profiles')
  .select('license_valid_until, city_sticker_expiry')
  .lte('city_sticker_expiry', ninetyDaysFromNow);

for (const profile of profiles) {
  const licenseExpiry = new Date(profile.license_valid_until);
  const stickerExpiry = new Date(profile.city_sticker_expiry);
  const renewalDate = new Date(stickerExpiry - 30 days); // 30 days before sticker expires

  // Check if license expires BEFORE renewal date
  if (licenseExpiry < renewalDate) {
    // Check if we have 60+ days to notify
    const daysUntilRenewal = (renewalDate - today) / days;

    if (daysUntilRenewal >= 60) {
      // Send email: "Your license expires before your next sticker"
      sendExpiringLicenseEmail(profile);
    }
  }
}
```

### Example Timeline:
```
Today: Jan 1, 2025
License expires: Mar 15, 2025
City sticker expires: Jun 1, 2025
Renewal date: May 1, 2025 (30 days before sticker expiry)

License expires (Mar 15) BEFORE renewal (May 1) ✓
Days until renewal: 120 days
120 >= 60? YES ✓

→ Send email NOW: "Your license expires before your next sticker. Upload updated DL."
```

### Email Sent:
```
Subject: 🚨 Update Your Driver's License - City Sticker Renewal

Hi John,

Your driver's license expires in 73 days (March 15, 2025), before your
next city sticker renewal on May 1, 2025.

📸 Upload Your Updated License:
https://ticketlesschicago.com/settings#license-upload

This will only take 2 minutes. We'll handle your renewals for the next
4 years automatically.
```

### Why 60+ days?
- Gives user time to renew their actual driver's license with DMV
- Gives user time to upload new license to your system
- Ensures license is valid when renewal happens

**Summary:** We notify 60+ days before city sticker renewal IF license expires before renewal.

---

## Quick Reference

| Question | Answer |
|----------|---------|
| **Utility bill email → storage?** | YES, automatically via Cloudflare → webhook → Supabase |
| **Bill updates automatically?** | YES, old bills deleted when new arrives |
| **License deletes after 48h access?** | YES (if opted out) - Remitter must ONLY access when submitting |
| **Delete bills every 30 days?** | YES - simple policy, no remitter confirmation needed |
| **License expiry notifications?** | 60+ days before RENEWAL (not expiry) if license expires before renewal |

---

## Files Created/Modified

### New Files:
- `pages/api/city-sticker/get-driver-license.ts` - Remitter endpoint (⚠️ triggers deletion timer!)
- `REMITTER_CRITICAL_INSTRUCTIONS.md` - Critical instructions for remitter

### Modified Files:
- `database/migrations/add_email_forwarding_id.sql` - Fixed has_permit_zone error
- `pages/api/cron/cleanup-residency-proofs.ts` - Simplified to 30-day deletion
- `pages/api/city-sticker/get-residency-proof.ts` - Removed incorrect license timestamp update

---

## What Remitter Needs to Know

1. **Two endpoints:**
   - `/api/city-sticker/get-driver-license` - ⚠️ Use ONLY when submitting
   - `/api/city-sticker/get-residency-proof` - ✅ Safe to use anytime

2. **Check `multiYearConsent` first:**
   - `true`: Safe to access license anytime
   - `false`: ONLY access when submitting (deletion timer starts!)

3. **Workflow:**
   - Check if docs exist
   - When ready to submit: Get signed URLs
   - Download PDFs
   - Submit to city IMMEDIATELY (within 24h)

See `REMITTER_CRITICAL_INSTRUCTIONS.md` for full details.
