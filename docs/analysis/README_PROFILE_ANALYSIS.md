# User Profile Page Analysis - Master Index

This directory now contains comprehensive documentation about the user profile page structure, components, and features.

## Documentation Files

### 1. PROFILE_PAGE_ANALYSIS.md (Comprehensive)
**Size**: 12KB | **Content**: Detailed feature breakdown
- Complete list of all profile sections
- Current UI sections being displayed
- Driver's license upload details (separate front/back)
- Proof of residency (utility bill) upload details
- User types (free vs paid, permit zone vs non-permit zone)
- Protection feature messaging
- Database schema fields

**Read this for**: Full understanding of what the profile page contains

### 2. PROFILE_FILES_INDEX.md (Quick Reference)
**Size**: 5.8KB | **Content**: File locations and code snippets
- All file paths (absolute)
- Supporting components list
- Key database fields
- Code snippets for common patterns
- Related pages and API endpoints
- Quick navigation guide

**Read this for**: Finding files and understanding code patterns

### 3. PROFILE_CODE_EXAMPLES.md (Code Deep Dive)
**Size**: 16KB | **Content**: Actual code from the codebase
- Complete code snippets from components
- Protection status display logic
- License upload form implementation
- Consent checkboxes
- Email forwarding setup
- Database interface definitions
- Conditional rendering patterns

**Read this for**: Copy-paste code examples and implementation details

## Quick Summary

### Main Files You Need
1. **Primary Profile Page**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx` (2500+ lines)
2. **Support Components**:
   - `UpgradeCard.tsx` - Shows protection status (free vs paid)
   - `DocumentStatus.tsx` - Shows license/residency upload status
   - `EmailForwardingSetup.tsx` - Utility bill forwarding instructions
   - `PermitZoneDocumentUpload.tsx` - Alternative upload interface
   - `LicenseAccessHistory.tsx` - License access audit log

### Current Profile Sections
All users see: Personal info, vehicle details, renewal dates, notifications
Free users additionally see: "Upgrade to Ticket Protection" card
Protected users additionally see: "You're Protected!" card + license plate options
Protected + Permit zone users additionally see: License upload (front & back) + email forwarding

### User Types
1. **Free User** - No protection subscription
2. **Protected User** - Has `has_protection = true`
3. **Permit Zone User** - Has `has_permit_zone = true` (requires license + residency uploads)
4. **Non-Permit Zone User** - No document uploads required

### Key Features
- **Protection**: Automatic renewals + 80% ticket reimbursement (up to $200/year)
- **License Upload**: Separate front & back, Google Vision API verification
- **Residency Proof**: Email forwarding of utility bills (ComEd, Peoples Gas, Xfinity/Comcast)
- **Document Status**: Shows upload dates, expiration warnings, verification status

## How to Use These Documents

### I want to understand the full profile experience
1. Read: PROFILE_PAGE_ANALYSIS.md (overview of all sections)
2. Then: PROFILE_FILES_INDEX.md (understand file structure)
3. Finally: PROFILE_CODE_EXAMPLES.md (see actual code)

### I want to modify the profile UI
1. Start: PROFILE_FILES_INDEX.md (find the right file)
2. Reference: PROFILE_CODE_EXAMPLES.md (see current implementation)
3. Implement: Use patterns shown in code examples

### I need to fix a specific feature
1. Find: PROFILE_FILES_INDEX.md (locate the component)
2. Review: PROFILE_CODE_EXAMPLES.md (understand the pattern)
3. Debug: Add console logs in the right locations

### I'm adding a new section
1. Check: PROFILE_PAGE_ANALYSIS.md (understand current sections)
2. Review: PROFILE_CODE_EXAMPLES.md (follow existing patterns)
3. Look at: PROFILE_FILES_INDEX.md (find the display condition pattern)

## Key Conditional Patterns

```tsx
// Show license upload only for:
if (profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone) {
  // Show license upload form
}

// Show protection upgrade or celebration based on:
if (profile.has_protection) {
  // Show "You're Protected!" card
} else {
  // Show "Upgrade" card
}

// Show permit zone features only for:
if (profile.has_permit_zone) {
  // Show DocumentStatus
  // Show EmailForwardingSetup
}
```

## Database Fields You'll Encounter

**Protection Status**:
- `has_protection: boolean`
- `is_paid: boolean`

**Permit Zone**:
- `has_permit_zone: boolean`

**License**:
- `license_image_path` (front)
- `license_image_path_back` (back)
- `license_image_uploaded_at`
- `license_image_back_uploaded_at`
- `license_valid_until`

**Residency**:
- `residency_proof_path`
- `residency_proof_uploaded_at`
- `residency_proof_verified: boolean`

**Email**:
- `email_forwarding_address`

## API Endpoints to Know

- `/api/protection/upload-license` - License image upload with verification
- `/api/utility-bills.ts` - Residency proof handling
- `/api/city-sticker/get-driver-license.ts` - Retrieve license info
- `/api/city-sticker/get-residency-proof.ts` - Retrieve residency info

## Related Pages

- `/pages/login.tsx` - Login page with "we handle registration" messaging
- `/pages/success.tsx` - Success page after signup
- `/pages/protection/*.tsx` - Protection upgrade/feature pages

## Document Versions

Created: 2025-11-13
Last Updated: 2025-11-13

All file paths are absolute paths from project root: `/home/randy-vollrath/ticketless-chicago/`
