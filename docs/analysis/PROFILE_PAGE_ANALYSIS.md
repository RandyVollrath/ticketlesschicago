# User Profile Page Analysis Summary

## File Locations

### Main Profile Files
1. **Primary Profile Page**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx`
   - Main settings/dashboard page for logged-in users
   - Contains most profile UI sections and features
   - ~2500+ lines of TSX

2. **Legacy Profile Page**: `/home/randy-vollrath/ticketless-chicago/pages/profile.tsx`
   - Older, simpler profile page (basic personal info)
   - Shows basic user information and notification preferences

### Related Components
- `/home/randy-vollrath/ticketless-chicago/components/UpgradeCard.tsx` - Shows protection status (free vs paid users)
- `/home/randy-vollrath/ticketless-chicago/components/DocumentStatus.tsx` - Shows license and residency proof status
- `/home/randy-vollrath/ticketless-chicago/components/PermitZoneDocumentUpload.tsx` - Document upload interface for permit zones
- `/home/randy-vollrath/ticketless-chicago/components/EmailForwardingSetup.tsx` - Email forwarding for utility bill receipts
- `/home/randy-vollrath/ticketless-chicago/components/LicenseAccessHistory.tsx` - Shows access history of license uploads

## Current Sections/Features Displayed

### 1. Personal Information Section
- Email address (read-only)
- First name
- Last name
- Phone number
- Mailing address (auto-filled from home address)
- City, State, ZIP

### 2. Vehicle Information
- License plate
- License state (dropdown: IL, etc.)
- VIN (17-character validation)
- Vehicle type (passenger, truck, SUV, van, motorcycle, commercial, other)
- Vehicle year
- ZIP code

### 3. Home Address Information
- Home address (full)
- Ward (Chicago ward number)
- Section (street section)

### 4. Renewal Dates (All Users)
- City Sticker expiry date
- License Plate expiry date
- Emissions date
- License Plate Type selector (for Protection users only)
  - Options: Passenger, Motorcycle, B-Truck, C-Truck, Persons with Disabilities, Recreational Trailer, RV
  - Weight specifications for RT/RV plates

### 5. Notification Settings
- Email notifications (checkbox)
- SMS notifications (checkbox)
- Voice/Phone call notifications (checkbox)
- Snow ban notifications
- Winter parking ban notifications
- Reminder schedule (days before: 60, 45, 37, 30, 14, 7, 3, 1, day-of)

### 6. Street Cleaning & Snow Ban Settings
- Integrated via `StreetCleaningSettings` component
- Integrated via `SnowBanSettings` component
- On snow route detection
- Winter ban street detection

### 7. Upgrade Card (Protection Status Indicator)
**Free Users** - See:
- "Upgrade to Ticket Protection" card
- Features: Renewal reminders, 80% ticket reimbursement (up to $200/year), Priority support
- Starting price: $12/month
- Button: "Get Protected"

**Protected Users** - See:
- Celebration card: "You're Protected!"
- Status: Active (green badge)
- Features listed: Renewal tracking, 80% reimbursement, Priority support
- Shield emoji indicator

### 8. Email Verification Status
- Shows verification status (verified/pending)
- Resend verification email option if needed

## Driver's License Upload (Permit Zone + Protection Users Only)

**Display Condition**: `profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone`

### Structure:
1. **Front & Back Separate Uploads**
   - Two separate file inputs: Front of License, Back of License
   - Separate preview images for each
   - Separate upload states and error handling

2. **Upload States**
   - File inputs accept: JPEG, JPG, PNG, WebP images
   - Shows loading spinner: "Verifying front/back image quality..."
   - Success message: "✓ Front/Back uploaded successfully! Image verified and ready for processing."
   - Error display with retry guidance

3. **Status Display**
   - Yellow warning banner if both sides not uploaded yet
   - Green success banner when both sides uploaded
   - Shows upload dates: "Front uploaded [date]. Back uploaded [date]."
   - Allows re-upload if needed

4. **Consent Requirements**
   - **Required**: "I consent to Google Cloud Vision API processing my driver's license image to verify image quality. The image will be immediately encrypted after verification and stored securely."
   - **Optional**: "Store my license until it expires (recommended). If unchecked, we'll delete it within 48 hours after processing your renewal, and you'll need to upload it again next year."
   - If reuse consent checked: asks for Driver's License Expiration Date

5. **Privacy & Security Messaging**
   - Bank-level encryption
   - Accessed only once per year, 30 days before city sticker renewal
   - Auto-deleted on license expiration if multi-year storage selected
   - Never sold or shared

6. **Photo Requirements**
   - Clear, well-lit images showing all text
   - Avoid glare, shadows, or blur

## Proof of Residency Upload (Permit Zone + Protection Users Only)

### Structure:
Handled via **Email Forwarding Setup** for automatic bill forwarding

#### `EmailForwardingSetup` Component displays:
1. **Unique Forwarding Email Address**
   - User-specific address for utility bill forwarding
   - Copy-to-clipboard button
   - Shows in format: `[email]@forwarding.address`

2. **Step-by-Step Instructions** for:
   - **ComEd (Commonwealth Edison)**
     - Filter emails from @comed.com
     - Filter for "bill OR statement" keywords
     - Forward to provided address
     - Click verification email link

   - **Peoples Gas**
     - Filter emails from @peoplesgasdelivery.com
     - Filter for "bill OR statement"
     - Forward to provided address

   - **Xfinity/Comcast (Internet)**
     - Filter emails from @xfinity.com or @comcast.net
     - Set up forwarding

3. **Verification Process**
   - Gmail sends one-time verification email
   - User clicks confirmation link
   - Bills then forward automatically

#### `DocumentStatus` Component displays:
- **Driver's License Status**
  - Green check if uploaded
  - Yellow warning if not uploaded
  - Shows upload date and expiration date
  - Warning if expiring within 90 days
  - "Upload Now" button if missing

- **Proof of Residency Status**
  - Green check if uploaded
  - Yellow warning if not uploaded
  - Shows most recent bill upload date
  - Shows verification status: "Verified and ready" or "Processing..."
  - Shows forwarding address if no bills received yet
  - "Set Up" button if missing

- **Combined Status Message**
  - Green celebration: "You're all set! We have your driver's license and utility bill."
  - Yellow action: "Action needed: Please upload missing documents above..."

## User Types & Features

### 1. **Free Users** (is_paid: false)
- No renewal tracking
- No reimbursement
- See UpgradeCard with promotion
- Cannot access:
  - Automatic license plate renewal
  - Ticket reimbursement features
  - Document uploads (until upgraded)

### 2. **Protected Users** (has_protection: true)
- Has ticket protection subscription
- Automatic renewal handling
- 80% ticket reimbursement (up to $200/year)
- Access to all settings
- See "You're Protected" celebration card

### 3. **Permit Zone Users** (has_permit_zone: true)
- Located at residential permit zone address
- **Required**: Driver's license upload (front & back)
- **Required**: Proof of residency (utility bill)
- Must provide:
  - Email forwarding setup for automatic bill collection
  - Google Vision API consent for license verification
  - License storage consent/expiration date

### 4. **Non-Permit Zone Users** (has_permit_zone: false)
- No license/residency uploads required
- No DocumentStatus section shown
- No EmailForwardingSetup shown

## "Protection" & "Registrations Done For You" References

### Protection Feature Messaging
- **UpgradeCard Component**: "Get comprehensive renewal reminders so you never miss city sticker, license plate, or emissions deadlines. Plus 80% reimbursement on eligible tickets"
- **Settings page banner**: "Complete protection from parking violations with automated renewal handling"
- **Settings.tsx interface**: `has_protection` boolean field tracks subscription status
- **Renewal handling**: Automatic license plate renewal options shown for protection users

### "Registrations Done For You" Messaging
Found in login page and success page:
- `/home/randy-vollrath/ticketless-chicago/pages/login.tsx`: "No more worrying about renewals — we handle registration on your behalf"
- `/home/randy-vollrath/ticketless-chicago/pages/success.tsx`: "All renewals will be automatically tracked and handled"
- Protection guarantee page mentions: "we handle your renewal before it expires so you never have to worry"

### Feature Calls-to-Action
- `/protection` page routes users to upgrade
- `UpgradeCard` component shows "Get Protected" CTA
- Settings page shows protection status with visual indicators

## Database Schema Fields (user_profiles table)

### Protection & Subscription
- `has_protection: boolean` - Whether user has active protection subscription
- `is_paid: boolean` - Payment status
- `is_canary: boolean` - Beta tester flag
- `guarantee_opt_in_year: number` - Year opted into guarantee

### Permit Zone
- `has_permit_zone: boolean` - Whether address in permit zone
- `license_image_path: string` - Path to driver's license front image
- `license_image_path_back: string` - Path to driver's license back image
- `license_image_uploaded_at: string` - Timestamp of license upload
- `license_image_back_uploaded_at: string` - Timestamp of back upload
- `license_valid_until: string` - License expiration date
- `residency_proof_path: string` - Path to proof of residency document
- `residency_proof_uploaded_at: string` - Timestamp of proof upload
- `residency_proof_verified: boolean` - Verification status

### Email Forwarding
- `email_forwarding_address: string` - Unique forwarding address for utility bills

### Consent
- License reuse consent tracked via UI state
- Third-party Vision API consent tracked via UI state

## Key Technical Implementation Details

1. **License Upload API**: `/api/protection/upload-license`
   - Separate front and back handling
   - Google Vision API integration for quality verification
   - Returns success message with timestamp

2. **Upload Flow**
   - File selection → Preview → Upload → Verification → Success/Error

3. **Conditional Rendering**
   - License upload section only shows if: `has_protection AND city_sticker_expiry AND has_permit_zone`
   - DocumentStatus component only shows if: `has_permit_zone`
   - EmailForwardingSetup only shows if: `has_protection AND has_permit_zone`

4. **Data Persistence**
   - Fields auto-saved on change
   - Licensed tracking with expiration dates
   - Separate upload timestamps for both sides

## Summary of Current User Profile Structure

The profile page is a comprehensive dashboard that serves different user types with contextual information:

- **Base sections** (all users): Personal info, vehicle details, renewal dates, notifications
- **Protection-only sections**: License plate type selector, renewal automation options
- **Permit zone + Protection sections**: License upload (separate front/back), Email forwarding setup, Document status
- **Free users**: See upgrade prompts and protection feature highlights
- **Paid/Protected users**: See confirmation of active protection with feature list

The "protection" feature is central to the app's value proposition (automatic renewals, reimbursement), while permit zone handling adds the additional document verification layer for specific Chicago addresses.
