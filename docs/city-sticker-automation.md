# City Sticker Registration Automation

## Overview
Automated city sticker registration/renewal through Chicago's EzBuy portal at `https://ezbuy.chicityclerk.com/vehicle-stickers`.

## Key Benefits
- ✅ **No CAPTCHA** - Unlike ticket payment portal, no captcha blocking
- ✅ **No ongoing costs** - No 2captcha service needed
- ✅ **Clean multi-step process** - Well-structured form with clear navigation
- ✅ **Saves users significant time** - Eliminates manual form filling

## Required User Data

To register/renew a city sticker, we need from the user:

1. **Last Name** (required)
   - Owner's last name as it appears on renewal statement
   - Example: "Vollrath"

2. **License Plate** (required)
   - Illinois license plate number
   - Example: "CW22016"

3. **VIN** (required)
   - Full 17-character Vehicle Identification Number
   - **Note:** System only needs last 6 characters
   - Example: "1HGCM82633A123456" → extracts "123456"

4. **Email** (required)
   - For confirmation and receipt
   - Example: "user@example.com"

### Optional Fields
- **Company Name** - If registering as a business
- **Reference Number** - If user has renewal notice

## Registration Flow

### Step 1: Instructions Page
- Portal shows eligibility requirements
- Click "Next" to proceed

### Step 2: Record Search
- Fill Customer Information (left side):
  - Last Name
  - OR Company Name
- Fill Record Information (right side):
  - Reference Number
  - OR (License Plate + VIN)
- Click "Search" to find vehicle record

### Step 3: Contact Information
- Fill email address
- System may pre-fill other contact details
- Click "Next"

### Step 4: Options/Cart
- Review city sticker options
- Select any add-ons
- Review pricing
- Click "Next"

### Step 5: Payment
- Enter payment information
- Complete purchase

## Current Status

### ✅ Completed
- Form field detection and filling
- Multi-step navigation
- VIN format handling (last 6 chars)
- Last name field integration
- Search button detection
- Error handling for ineligible vehicles
- Dry run mode for testing

### ⚠️ Limitations
- Cannot test beyond Record Search without a vehicle actually due for renewal
- Search button is disabled if vehicle not in system/not eligible
- Payment integration not yet implemented (stops at dry run)

## Testing

Run the test script:
```bash
node scripts/test-city-sticker-automation.js
```

This tests with placeholder data and stops before payment (dry run mode).

## Integration Plan

When ready to add to user dashboard:

1. **Data Collection**
   - Add form to collect: Last Name, License Plate, Full VIN, Email
   - Store securely in user profile

2. **Eligibility Check**
   - Query if vehicle is due for renewal
   - Show status to user

3. **One-Click Registration**
   - Button to trigger automation
   - Show progress indicator
   - Handle payment securely

4. **Confirmation**
   - Display confirmation number
   - Send receipt via email
   - Update user's vehicle record

## Code Location

- **Automation Library:** `/lib/city-sticker-automation.ts`
- **Test Script:** `/scripts/test-city-sticker-automation.js`
- **Test Results:** Screenshots in project root (`city-sticker-auto-step*.png`)
