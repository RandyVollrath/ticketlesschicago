# User Profile Page - File Index & Quick Reference

## Core Files You Need to Know

### 1. Main Settings/Profile Dashboard
**File**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx`
- The primary user-facing profile/settings page
- Contains all sections: personal info, vehicle details, renewals, licenses, residency proof, notifications
- ~2500 lines of code
- This is where 95% of the profile UI lives

**Key UI Sections in this file**:
- Lines 1649-2076: Driver's License upload (front & back)
- Lines 2078-2356: Renewal dates section
- Lines 1107-1109: EmailForwardingSetup component integration
- Lines 1650: DocumentStatus component integration (for permit zone users)

### 2. Legacy/Simpler Profile Page
**File**: `/home/randy-vollrath/ticketless-chicago/pages/profile.tsx`
- Older implementation, simpler UI
- Used for basic profile editing
- Less commonly used

---

## Supporting Components

### 3. Protection Status Card Component
**File**: `/home/randy-vollrath/ticketless-chicago/components/UpgradeCard.tsx`
- Shows different content for free vs protected users
- Free users: "Upgrade to Ticket Protection" call-to-action
- Protected users: "You're Protected!" celebration card
- Props: `hasProtection: boolean`

### 4. Document Status Display Component
**File**: `/home/randy-vollrath/ticketless-chicago/components/DocumentStatus.tsx`
- Shows license & residency proof upload status
- Only displays for permit zone users
- Shows status badges (green=done, yellow=needed)
- Conditional display: only shown when `hasPermitZone={true}`
- Uses these database fields:
  - `license_image_path`, `license_image_uploaded_at`, `license_valid_until`
  - `residency_proof_path`, `residency_proof_uploaded_at`, `residency_proof_verified`

### 5. Email Forwarding Setup Component
**File**: `/home/randy-vollrath/ticketless-chicago/components/EmailForwardingSetup.tsx`
- Shows unique email forwarding address for utility bills
- Step-by-step instructions for ComEd, Peoples Gas, Xfinity/Comcast
- Copy-to-clipboard button
- Only shown for permit zone + protection users
- Props: `forwardingEmail: string`

### 6. License Upload Component
**File**: `/home/randy-vollrath/ticketless-chicago/components/PermitZoneDocumentUpload.tsx`
- Alternative/older license upload interface
- Handles ID document + proof of residency uploads
- May be used in different context than settings.tsx

### 7. License Access History
**File**: `/home/randy-vollrath/ticketless-chicago/components/LicenseAccessHistory.tsx`
- Shows when and how the license image was accessed
- Transparency/audit log feature

---

## Key Database Fields

Located in `user_profiles` table (referenced throughout settings.tsx):

**Protection Status**:
- `has_protection: boolean` - Active protection subscription
- `is_paid: boolean` - Payment status

**Permit Zone Info**:
- `has_permit_zone: boolean` - Located in residential permit zone

**Driver's License**:
- `license_image_path: string` - Front image path
- `license_image_path_back: string` - Back image path
- `license_image_uploaded_at: string` - Front upload timestamp
- `license_image_back_uploaded_at: string` - Back upload timestamp
- `license_valid_until: string` - Expiration date

**Proof of Residency**:
- `residency_proof_path: string` - Utility bill image path
- `residency_proof_uploaded_at: string` - Upload timestamp
- `residency_proof_verified: boolean` - Verification status

**Email Forwarding**:
- `email_forwarding_address: string` - Unique forwarding address

---

## Code Snippets for Common Tasks

### Check if user sees license upload section:
```tsx
if (profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone) {
  // Show license upload form
}
```
(See line 1650 in settings.tsx)

### Check if user sees document status:
```tsx
if (hasPermitZone) {
  // Show DocumentStatus component
}
```
(See DocumentStatus.tsx line 65)

### Check if user sees upgrade card:
```tsx
if (!hasProtection) {
  // Show "Upgrade to Ticket Protection" card
} else {
  // Show "You're Protected!" card
}
```
(See UpgradeCard.tsx line 17)

---

## User Type Conditions

### Free User (not `has_protection`)
- See UpgradeCard with "$12/month" pricing
- See "Upgrade to Ticket Protection" CTA
- Cannot see license/residency upload sections

### Protected User (`has_protection: true`)
- See "You're Protected!" celebration card
- See protection features confirmed
- Can access document uploads if permit zone

### Permit Zone User (`has_permit_zone: true`)
- **Must have**: Driver's license front & back
- **Must have**: Proof of residency (utility bill)
- See DocumentStatus component
- See EmailForwardingSetup instructions

### Non-Permit Zone User (`has_permit_zone: false`)
- No document uploads needed
- No DocumentStatus shown
- No EmailForwardingSetup shown

---

## Related Pages

- `/pages/login.tsx` - Has "No more worrying about renewals — we handle registration on your behalf" messaging
- `/pages/success.tsx` - Shows success message with renewal automation promises
- `/pages/protection/*.tsx` - Feature/pricing pages for protection upgrade
- `/pages/renewal-intake.tsx` - Alternative license/residency upload flow

---

## API Endpoints Referenced

- `/api/protection/upload-license` - License image upload with verification
- `/api/utility-bills.ts` - Handles residency proof
- `/api/city-sticker/get-driver-license.ts` - Retrieves license info
- `/api/city-sticker/get-residency-proof.ts` - Retrieves residency info

---

## Quick Navigation

To understand the full profile experience:
1. Start with `/pages/settings.tsx` (lines 1-200 for interface definitions)
2. See rendering from line 942 onwards
3. Check `/components/UpgradeCard.tsx` for protection status display
4. Review `/components/DocumentStatus.tsx` for permit zone display
5. Look at `/components/EmailForwardingSetup.tsx` for bill forwarding flow
