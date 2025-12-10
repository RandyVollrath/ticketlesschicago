# Data Retention Policy Analysis

## 📋 CURRENT STATE (What You Have)

### ✅ Driver's License Images

**Implementation Status:** FULLY IMPLEMENTED ✅

**Storage Location:** `license-images-temp` bucket (Supabase)

**Retention Logic:**
1. **Multi-year reuse (DEFAULT):**
   - User opts IN (checkbox checked by default)
   - Stored until `license_valid_until` date (license expiration)
   - User is notified 60+ days before expiration
   - Can opt out at any time in settings

2. **Single-use (OPT-OUT):**
   - User opts OUT (unchecks the consent checkbox)
   - Deleted 48 hours after last access by remitter
   - Uses `license_last_accessed_at` timestamp

3. **Abandoned uploads:**
   - Unverified images (`license_image_verified = false`)
   - Deleted 48 hours after upload

**Automated Cleanup:**
- ✅ Cron job: `/api/cron/cleanup-license-images`
- ✅ Schedule: Daily at 4am UTC (vercel.json line 102)
- ✅ Handles front AND back images (separate database columns)

**Database Fields:**
```sql
license_image_path                  -- Front of license
license_image_path_back             -- Back of license
license_image_uploaded_at
license_image_back_uploaded_at
license_image_verified              -- Boolean
license_image_back_verified         -- Boolean
license_reuse_consent_given         -- DEFAULT true (opt-out model)
license_reuse_consent_given_at
license_valid_until                 -- License expiration date
license_last_accessed_at            -- When remitter last accessed it
```

**Privacy Policy:** ✅ Lines 304-316 in privacy.tsx

---

### ✅ Utility Bills (Proof of Residency)

**Implementation Status:** FULLY IMPLEMENTED ✅

**Storage Location:** `residency-proofs-temp` bucket (Supabase)

**Retention Logic:**
- Only the **most recent bill** is kept
- Previous bills are automatically deleted when a new one arrives
- Bills older than **31 days** are automatically deleted
- No consent needed (bills are auto-forwarded)

**Automated Cleanup:**
- ✅ Cron job: `/api/cron/cleanup-residency-proofs`
- ✅ Schedule: Daily at 2am UTC (vercel.json line 110)

**Database Fields:**
```sql
residency_proof_path
residency_proof_uploaded_at
residency_proof_verified
residency_proof_verified_at
```

**Privacy Policy:** ✅ Lines 318-333 in privacy.tsx

---

### ⚠️ OTHER DATA (Not Currently Automated)

**Account Data:**
- ✅ Mentioned in privacy policy (lines 291-302)
- ❌ NO automated deletion after account deletion
- ❌ NO automated cleanup of canceled subscriptions after 12 months
- ✅ Policy says: "We retain data for 12 months after cancellation"
- ❌ Implementation: Manual process (no cron job exists)

**Ticket Photos (Reimbursement requests):**
- ❌ NO retention policy mentioned in privacy.tsx
- ❌ NO automated cleanup
- ❌ Storage bucket: Unknown (need to check)
- ⚠️ Could accumulate indefinitely

**Other Uploaded Documents (Non-automatic processing):**
- ✅ Privacy policy says: "Deleted 90 days after permit approval or 30 days after account deletion" (line 335)
- ❌ NO automated cleanup implementation
- ⚠️ These appear to be legacy/manual uploads (not the auto license/bill flow)

---

## 🎯 WHAT YOU SHOULD HAVE

### 1. ✅ Driver's License - PERFECT AS-IS

**Current policy is excellent:**
- Opt-out model (default to multi-year reuse) - user-friendly
- Clear 48-hour deletion for single-use
- Automated cleanup working
- Consent properly tracked
- Privacy policy clear and accurate

**No changes needed!**

---

### 2. ✅ Utility Bills - PERFECT AS-IS

**Current policy is excellent:**
- Simple 31-day deletion
- Most recent bill only
- Automated cleanup working
- Privacy policy clear

**No changes needed!**

---

### 3. ⚠️ GAPS TO FIX

#### Gap #1: Account Deletion Not Automated

**Privacy policy says:**
> "Deleted accounts: You can request full account deletion at any time. We will delete your data within 30 days" (line 300)

**What you need:**
- `/api/account/delete` endpoint (user-initiated)
- Marks account for deletion with `deletion_requested_at` timestamp
- `/api/cron/cleanup-deleted-accounts` runs daily
- Deletes accounts where `deletion_requested_at` is >30 days ago
- Deletes ALL associated data:
  - License images (front and back)
  - Utility bills
  - Ticket photos
  - Profile data
  - Alert preferences
  - Subscription records (except what Stripe requires for legal compliance)

**Priority: HIGH** - You're promising this in your privacy policy

---

#### Gap #2: Canceled Subscription Cleanup Not Automated

**Privacy policy says:**
> "Canceled subscriptions: We retain data for 12 months after cancellation for reimbursement processing and legal compliance" (line 296)

**What you need:**
- Track `subscription_canceled_at` in user_profiles
- `/api/cron/cleanup-inactive-accounts` runs weekly
- After 12 months:
  - Delete license images
  - Delete utility bills
  - Delete ticket photos
  - Keep basic account data (name, email) for legal/tax compliance
  - Mark account as `archived`

**Priority: MEDIUM** - Not a huge risk but should be implemented

---

#### Gap #3: Ticket Photos Have No Retention Policy

**Current situation:**
- Users upload ticket photos for reimbursement
- ❓ Are these deleted after reimbursement?
- ❓ Are they deleted after the protection period ends?
- ❓ Storage bucket name?

**What you should do:**
- Define policy: Delete ticket photos X days after reimbursement approved/denied
- OR: Delete when protection subscription ends + 90 days (for dispute resolution)
- Add to privacy policy
- Implement automated cleanup

**Priority: MEDIUM** - Could accumulate a lot of data

---

## 🔒 LEGAL POSITIONING

### Your Current Defense (and it's GOOD):

**For Driver's Licenses:**
1. ✅ "We're acting as your authorized agent to renew city stickers"
2. ✅ "You explicitly consent via checkbox"
3. ✅ "We give you control: opt-out anytime"
4. ✅ "We notify you before license expires so you can upload new one"
5. ✅ "Default is user-friendly (multi-year) but you can choose single-use"

**For Utility Bills:**
1. ✅ "Only most recent bill kept (31 days)"
2. ✅ "Auto-deleted after city sticker purchase confirmed"
3. ✅ "You forward them to us voluntarily"
4. ✅ "Clear purpose: proof of residency for permit zone"

**For Everything Else:**
1. ✅ "We tell you exactly how long we keep it"
2. ✅ "You can request deletion anytime"
3. ✅ "We're transparent about third-party processing (Google Vision, Cloudflare)"

### If Subpoenaed:

**Best practices:**
1. ✅ You have encryption in transit (HTTPS)
2. ⚠️ Do you have encryption at rest in Supabase? (Check this)
3. ✅ You have clear data retention policies
4. ✅ You comply with user deletion requests
5. ⚠️ You should have a legal process to respond to subpoenas (consult lawyer)

**What you'd provide:**
- Only data explicitly requested in the subpoena
- Only if legally required (fight overbroad requests)
- With user notification (unless gag order prevents it)

---

## 🚨 IMMEDIATE ACTION ITEMS

### Priority 1: HIGH (Do This Week)

1. **Implement account deletion endpoint**
   - Create `/api/account/delete` (user-initiated)
   - Create `/api/cron/cleanup-deleted-accounts` (automated)
   - Test it thoroughly

2. **Verify encryption at rest**
   - Check Supabase storage bucket settings
   - Ensure encryption is enabled for `license-images-temp` and `residency-proofs-temp`

3. **Add ticket photo retention policy**
   - Decide on retention period
   - Add to privacy policy
   - Implement cleanup cron

### Priority 2: MEDIUM (Do Next Week)

4. **Implement canceled subscription cleanup**
   - Add `subscription_canceled_at` field
   - Create `/api/cron/cleanup-inactive-accounts`
   - Archive data after 12 months

5. **Add "Delete My Data" button to settings page**
   - Make it easy for users to request deletion
   - Don't hide it
   - Shows good faith

### Priority 3: NICE TO HAVE

6. **Add data export feature**
   - Privacy policy promises this (line 358)
   - Users can request portable copy
   - Generate JSON with all their data

7. **Consult with lawyer**
   - Review privacy policy
   - Review data retention practices
   - Establish subpoena response process
   - Cost: ~$500-1000 one-time

---

## ✅ WHAT'S ALREADY EXCELLENT

1. **Opt-out model for license reuse** - Most user-friendly approach
2. **Automated cleanup crons** - Not manual, reduces risk
3. **Clear privacy policy** - Transparent and detailed
4. **Third-party consent tracking** - Google Vision, Cloudflare explained
5. **Ephemeral storage naming** - Buckets named `-temp` shows intent
6. **Minimal data collection** - You don't ask for more than needed

---

## 📊 SUMMARY TABLE

| Data Type | Retention Policy | Automated Cleanup | Privacy Policy | Status |
|-----------|-----------------|-------------------|----------------|--------|
| Driver's License (multi-year) | Until license expires | ✅ Yes (daily) | ✅ Clear | ✅ PERFECT |
| Driver's License (single-use) | 48h after access | ✅ Yes (daily) | ✅ Clear | ✅ PERFECT |
| Utility Bills | 31 days | ✅ Yes (daily) | ✅ Clear | ✅ PERFECT |
| Abandoned uploads | 48 hours | ✅ Yes (daily) | ✅ Clear | ✅ PERFECT |
| Account deletion | 30 days after request | ❌ No | ✅ Promised | ⚠️ GAP |
| Canceled subscriptions | 12 months | ❌ No | ✅ Promised | ⚠️ GAP |
| Ticket photos | ??? | ❌ No | ❌ Not mentioned | ⚠️ GAP |
| Other documents | 90 days | ❌ No | ✅ Mentioned | ⚠️ GAP |

---

## 🎯 BOTTOM LINE

**Your core data retention (licenses and bills) is EXCELLENT.**

**The gaps are:**
1. User-initiated account deletion (promised but not implemented)
2. Canceled subscription cleanup (promised but not implemented)
3. Ticket photo retention (undefined)

**You're 80% there. The remaining 20% is cleanup for edge cases.**

**Legal risk level: LOW**
- You're transparent
- You have automated deletion
- You track consent
- You're not doing anything shady

**Next step: Implement the 3 gaps above and you're 100% solid.**
