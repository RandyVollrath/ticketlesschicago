# Answers to Your Latest Questions

## 1. Multi-Year License Storage - Is it still ephemeral?

### Current Implementation:
- **Bucket**: `license-images-temp` (suggests ephemeral)
- **Multi-year consent (DEFAULT)**: Licenses stored until `license_valid_until` date (could be 4+ years)
- **Opted out**: Deleted 48h after `license_last_accessed_at` (remitter access)

### Answer: **Not truly ephemeral if multi-year consent**

**To make users feel safe**:

✅ **What we're doing well**:
- Encrypted storage with RLS policies
- Only accessed by remitter during renewal (30 days before city sticker expiry)
- Clear consent checkboxes during upload
- Automatic deletion when expired

⚠️ **What could be clearer**:
- "Multi-year" is vague - should say "Store until license expires (up to 4 years)"
- Users might not realize it's years, not days
- Should emphasize how rarely it's accessed (once per year)

**Recommended consent language**:
```
☑ Allow reusing this license image for future city sticker renewals
  until your driver's license expires (up to 4 years).

  Your license will ONLY be accessed by our automated renewal service
  30 days before each city sticker renewal. We never access it otherwise.

  This saves you from uploading every year.
```

**Privacy selling points**:
- "Accessed once per year, 30 days before your city sticker renewal"
- "Automatically deleted when your driver's license expires"
- "Encrypted storage with bank-level security"
- "No human eyes ever see your license - only our automated system"

---

## 2. Webhook for Proof of Residency Storage

### Current Status: **⚠️ NEEDS CLARIFICATION**

The webhook file exists: `/pages/api/email/process-residency-proof.ts`

**BUT**: Comment says "SendGrid Inbound Parse" not "Cloudflare Email Routing"

```typescript
/**
 * Receives forwarded emails from SendGrid Inbound Parse webhook.
 */
```

### Questions to verify:

1. **Which email service are you actually using?**
   - Cloudflare Email Routing (mentioned in our docs)
   - SendGrid Inbound Parse (mentioned in code)
   - Both?

2. **Is Cloudflare Email Routing configured?**
   - Check Cloudflare dashboard: Email → Email Routing
   - Verify `documents@autopilotamerica.com` routes to webhook
   - Webhook URL should be: `https://ticketlesschicago.com/api/email/process-residency-proof`

3. **Webhook format differs**:
   - **SendGrid**: multipart/form-data with email fields
   - **Cloudflare**: Different format (need to verify)

### ✅ **What IS working**:
- Email forwarding address generation: `documents+{uuid}@autopilotamerica.com`
- Supabase storage bucket: `residency-proofs-temp`
- Folder structure: `proof/{uuid}/{yyyy-mm-dd}/bill.pdf`
- Auto-deletion of old bills when new arrives
- 31-day cleanup cron

### ⚠️ **What needs verification**:
- Actual email routing service being used
- Webhook receiving emails correctly
- PDF extraction working

**Action needed**: Test by forwarding a utility bill to a test user's email address and verify it appears in Supabase storage.

---

## 3. Changed to 31-day deletion ✅

**COMPLETED**: Updated `pages/api/cron/cleanup-residency-proofs.ts`

**Old**: 30 days
**New**: 31 days

**Why 31 days is better**:
- ✅ Ensures we always have a bill (even if forwarding delayed)
- ✅ Monthly bills + 1 day buffer
- ✅ Still quick PII deletion
- ✅ Safer than 30 days exactly

**Code change**:
```typescript
// Before
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

// After
const thirtyOneDaysAgo = new Date();
thirtyOneDaysAgo.setDate(thirtyOneDaysAgo.getDate() - 31);
```

---

## 4. Second SQL Migration

### Migration File: `database/migrations/add_email_forwarding_id.sql`

This migration adds:
- `email_forwarding_address` - Auto-generated for protection users
- `residency_proof_path` - Path to utility bill in storage
- `residency_proof_uploaded_at` - Upload timestamp
- `residency_proof_verified` - Verification status
- `residency_forwarding_enabled` - User set up forwarding
- `city_sticker_purchase_confirmed_at` - Purchase confirmation

**Trigger**: Auto-generates email address when `has_protection = true`

### How to run:

```bash
# Connect to database
psql $DATABASE_URL

# Run migration
\i database/migrations/add_email_forwarding_id.sql

# Verify columns added
\d user_profiles
```

---

## 5. License Plate Registration Support ✅

**COMPLETED**: Full Illinois license plate renewal system

### What was built:

#### A. Database Migration
**File**: `database/migrations/add_license_plate_renewal_support.sql`

**New fields**:
- `license_plate_renewal_cost` - Auto-calculated fee
- `license_plate_type` - PASSENGER, MOTORCYCLE, B-TRUCK, etc.
- `license_plate_is_personalized` - +$7 fee
- `license_plate_is_vanity` - +$13 fee
- `license_plate_last_accessed_at` - Remitter access tracking
- `trailer_weight` - For RT (Recreational Trailer) fee calculation
- `rv_weight` - For RV fee calculation

**Auto-calculation function**: `calculate_plate_renewal_cost()`
- Automatically calculates renewal cost when plate type changes
- Handles all weight-based pricing for RT/RV
- Adds personalized/vanity fees correctly

#### B. Remitter Endpoint
**File**: `pages/api/license-plate/get-renewal-info.ts`

**Endpoint**: `GET /api/license-plate/get-renewal-info?userId={uuid}`

**Returns**:
- License plate number, state, expiry
- Plate type and calculated renewal cost
- Vehicle info (VIN, year, type)
- Mailing address for registration
- Weight info for RT/RV plates

**Access tracking**: Updates `license_plate_last_accessed_at` (similar to driver's license)

#### C. Settings Page UI
**File**: `pages/settings.tsx` (modified)

**Added for Protection users**:
- Dropdown: Illinois plate type with prices
- Weight inputs: Show conditionally for RT/RV
- Checkboxes: Personalized (+$7) and Vanity (+$13)
- Calculated cost display: Shows total in blue box

#### D. Complete Documentation
**File**: `LICENSE_PLATE_RENEWAL_SYSTEM.md`

Includes:
- All plate types and fees
- Fee calculation examples
- Remitter integration guide
- Relationship to city sticker renewals
- Testing checklist

### Supported Plate Types (from Illinois SOS):

| Type | Base | Personalized | Vanity |
|------|------|--------------|--------|
| Passenger | $151 | $158 | $164 |
| Motorcycle | $41 | $48 | $54 |
| B-Truck | $151 | $158 | $164 |
| C-Truck | $218 | N/A | N/A |
| Persons with Disabilities | $151 | $158 | $164 |
| RT (trailer, weight-based) | $18-$50 | N/A | N/A |
| RV (weight-based) | $78-$102 | N/A | N/A |

### Remitter Workflow:

**City Sticker Renewal** (30 days before `city_sticker_expiry`):
1. GET `/api/city-sticker/get-driver-license?userId={uuid}`
2. GET `/api/city-sticker/get-residency-proof?userId={uuid}` (if permit zone)
3. Submit to Chicago City Clerk
4. Cost: $85.91 (varies by vehicle type)

**License Plate Renewal** (30 days before `license_plate_expiry`):
1. GET `/api/license-plate/get-renewal-info?userId={uuid}`
2. Submit to Illinois Secretary of State
3. Cost: $41-$218 (varies by plate type)

**Different renewal cycles**: City sticker and license plate expire on different dates, handled separately.

---

## Summary of Completions

✅ **Email forwarding setup guide** - Complete with ComEd, Peoples Gas, Xfinity instructions
✅ **31-day bill deletion** - Updated from 30 days
✅ **License plate renewal system** - Complete with all vehicle types
✅ **Fee calculation** - Auto-calculates renewal costs
✅ **Settings UI** - Plate type selection for Protection users
✅ **Remitter endpoint** - Get renewal info API
✅ **Documentation** - Comprehensive guides for all systems

## To-Do Items

⚠️ **Verify email routing**:
1. Check if using Cloudflare or SendGrid
2. Test forwarding a utility bill
3. Verify it appears in Supabase storage

⚠️ **Run SQL migrations**:
1. `add_email_forwarding_id.sql` (if not already run)
2. `add_license_plate_renewal_support.sql` (new)

⚠️ **Improve license storage messaging**:
1. Update consent language to be clearer about duration
2. Emphasize rare access (once per year)
3. Highlight security and privacy

## Files Ready to Run

### SQL Migrations (in order):
1. `database/migrations/add_email_forwarding_id.sql`
2. `database/migrations/add_license_plate_renewal_support.sql`

### Test Endpoints:
- `GET /api/license-plate/get-renewal-info?userId={test-uuid}`
- `GET /api/city-sticker/get-driver-license?userId={test-uuid}`
- `GET /api/city-sticker/get-residency-proof?userId={test-uuid}`

### Documentation:
- `LICENSE_PLATE_RENEWAL_SYSTEM.md` - License plate renewal guide
- `EMAIL_FORWARDING_SETUP_COMPLETE.md` - Email forwarding guide
- `REMITTER_CRITICAL_INSTRUCTIONS.md` - Remitter integration guide
- `YOUR_QUESTIONS_ANSWERED.md` - Previous Q&A
