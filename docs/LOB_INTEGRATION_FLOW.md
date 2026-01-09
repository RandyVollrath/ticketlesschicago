# Lob Integration Flow for Parking Contest Letters

## Overview
This document describes the complete flow of how parking contest letters are detected, generated, and mailed to the City of Chicago via Lob.com integration.

---

## 1. VA CSV Upload Flow
**File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/autopilot/upload-results.ts`

### What Happens on Upload

#### 1.1 File Reception & Parsing
- VA admin uploads a CSV file with the following format:
  ```
  last_name, first_name, plate, state, user_id, ticket_number, violation_code, violation_type, violation_date, amount
  ```
- The endpoint uses **formidable** to parse the uploaded file
- Only rows with a `ticket_number` are processed (ensures ticket was actually found)

#### 1.2 CSV Processing
- Headers are normalized (lowercase, remove quotes, convert spaces to underscores)
- Supports alternative column names for flexibility:
  - `ticketnumber` → `ticket_number`
  - `violationtype` → `violation_type`
  - `violationcode` → `violation_code`
  - `violation_date` → `violation_date`
  - `licenseplate` → `plate`
  - etc.

#### 1.3 Violation Type Normalization
- Raw violation types are normalized to standardized values:
  - Contains "expired" + "plate/registration/sticker" → `expired_plates`
  - "city sticker" or "no sticker" or "wheel tax" → `no_city_sticker`
  - "meter" or "parking meter" → `expired_meter`
  - "disabled" or "handicap" → `disabled_zone`
  - "street clean" or "sweeping" → `street_cleaning`
  - "rush hour" or "tow zone" → `rush_hour`
  - "hydrant" or "fire" → `fire_hydrant`
  - "speed" or "camera" → `speed_camera`
  - "red light" → `red_light_camera`
  - Fallback: `other_unknown`

---

## 2. Ticket Creation on Upload
**File**: `/home/randy-vollrath/ticketless-chicago/pages/api/admin/autopilot/upload-results.ts` (lines 820-935)

### Per-Ticket Processing

1. **Verify Monitored Plate** (line 823-835)
   - Query `monitored_plates` table
   - Match by: `plate.toUpperCase()`, `state.toUpperCase()`, `status = 'active'`
   - Skip if no active plate found

2. **Check for Duplicates** (line 837-847)
   - Query `detected_tickets` for existing `ticket_number`
   - Skip if already exists

3. **Create Ticket Record** (line 876-897)
   ```sql
   INSERT INTO detected_tickets
   - user_id: from monitored_plate.user_id
   - plate_id: from monitored_plate.id
   - plate: ticket.plate (uppercase)
   - state: ticket.state (uppercase)
   - ticket_number: ticket.ticket_number
   - violation_code: parsed from CSV
   - violation_type: normalized value
   - violation_date: parsed from CSV
   - amount: parsed from CSV
   - status: 'pending_evidence'  ← KEY STATUS
   - evidence_deadline: NOW + 72 HOURS  ← KEY DEADLINE
   - source: 'va_upload'
   ```

4. **Generate Contest Letter** (line 907-944)
   - Get user profile for mailing address
   - Select defense template based on violation_type
   - Generate letter content with template substitution
   - Variables replaced: {ticket_number}, {violation_date}, {amount}, {location}, {plate}, {state}
   - Insert into `contest_letters` table with:
     - `status: 'pending_evidence'`
     - `letter_content` and `letter_text` (same content)
     - `defense_type`: from template

5. **Send Evidence Request Email** (line 946-965)
   - Email user with ticket details
   - Include evidence questions specific to violation type
   - Set reply-to: `evidence@autopilotamerica.com`
   - Include evidence deadline

6. **Audit Log** (line 967-980)
   - Record ticket detection in `ticket_audit_log`
   - Include evidence deadline and email status

### Results Reported
- Tickets created count
- Letters generated count
- Emails sent count
- Errors (with details)

---

## 3. Letter Generation (Separate Cron)
**File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-generate-letters.ts`

### Purpose
Generates contest letters for tickets that haven't had one created yet.

### Trigger
- **Schedule**: Not defined in vercel.json (only mail-letters cron is scheduled)
- Could be triggered manually or via background job

### Key Steps

1. **Check Kill Switches** (line 329-345)
   - `kill_all_mailing` setting
   - `maintenance_mode` setting
   - Returns early if either enabled

2. **Find Tickets Needing Letters** (line 568-582)
   - Query `detected_tickets` with `status = 'found'`
   - Process up to 50 at a time
   - Order by `found_at` ascending

3. **Per-Ticket Processing** (line 590-602)
   - Get user profile
   - Get user email
   - Get user settings (auto_mail_enabled, require_approval, allowed_ticket_types, etc.)
   - Determine if approval needed based on settings:
     - If `auto_mail_enabled = false` → needs approval
     - If `require_approval = true` → needs approval
     - If violation_type not in `allowed_ticket_types` → needs approval
     - If `violation_type = 'other_unknown'` AND `never_auto_mail_unknown = true` → needs approval
   
4. **Generate Letter** (line 481-495)
   - Create letter content from template
   - Insert into `contest_letters` with:
     - `status: 'pending_approval'` (if approval needed)
     - `status: 'draft'` (if no approval needed)

5. **Update Ticket Status** (line 501-509)
   - If approval needed: `status = 'needs_approval'`
   - If ready to mail: `status = 'letter_generated'`

6. **Send Approval Email** (line 528-536)
   - If user has `require_approval` setting enabled
   - Include approval/skip buttons
   - Token-based approval links

---

## 4. Letter Mailing (Main Cron)
**File**: `/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-mail-letters.ts`

### Cron Schedule
**vercel.json** (line 151-152):
```json
{
  "path": "/api/cron/autopilot-mail-letters",
  "schedule": "0 15 * * *"
}
```
- **Runs daily at 3:00 PM UTC** (15:00)
- Max duration: 120 seconds

### Key Checks & Kill Switches

1. **LOB_API_KEY Check** (line 343-350)
   ```typescript
   if (!process.env.LOB_API_KEY) {
     return 500 error with "Lob API key not configured"
   }
   ```

2. **Kill Switches** (line 353-362)
   - Checks `autopilot_admin_settings` table
   - Looks for: `pause_all_mail` with `enabled = true`
   - If active, returns 200 with message "Kill switch active: mailing disabled"
   - Gracefully skips mailing without error

### Letter Selection Logic (line 366-440)

```
Get ALL letters with status IN ('pending_evidence', 'approved', 'draft')
FILTER by:
- Letter must have associated ticket
- Skip if ticket.is_test = true
- Only mail if ticket.evidence_deadline <= NOW

Returns:
- readyLetters: array of letters ready to mail
- pendingLetters: letters still waiting for evidence deadline
```

### Per-Letter Processing (line 447-496)

For each ready letter:

1. **Get User Profile** (line 448-459)
   - Query `user_profiles` by `user_id`
   - Skip if missing mailing_address
   - Build full_name from first_name/last_name if needed

2. **Mail Letter via Lob** (line 468-472)
   - Call `sendLetter()` function with:
     - `from`: User's mailing address
     - `to`: Chicago Department of Finance (PO Box 88292, Chicago, IL 60680-1292)
     - `letterContent`: HTML-formatted letter text
     - `description`: "Contest letter for ticket {ticket_number}"
     - `metadata`: { ticket_id, letter_id, user_id }

3. **Update Letter Record** (line 105-115 in mailLetter function)
   ```sql
   UPDATE contest_letters SET
   - status: 'mailed'
   - lob_letter_id: result.id
   - letter_pdf_url: result.url
   - tracking_number: result.tracking_number
   - mailed_at: NOW
   - sent_at: NOW
   ```

4. **Update Ticket Record** (line 118-121)
   ```sql
   UPDATE detected_tickets SET
   - status: 'mailed'
   WHERE id = letter.ticket_id
   ```

5. **Audit Log** (line 124-136)
   - Record letter_mailed action
   - Include Lob letter ID and tracking number

6. **Increment Letter Count** (line 306-328)
   - Update `autopilot_subscriptions.letters_used_this_period`
   - Check if user exceeded included letters
   - Note: TODO to charge for additional letters via Stripe

7. **Send User Email Notification** (line 172-301)
   - Only if `email_on_letter_sent` != false in user settings
   - Include expected delivery date
   - Include PDF link
   - Explain next steps
   - Professional HTML email template

### Error Handling

If mailing fails:
- Letter status → `'failed'`
- Audit log with error message
- Continue processing next letters
- Returns 200 with error count

### Rate Limiting
- 1 second delay between API calls (line 495-496)

---

## 5. Lob Service Integration
**File**: `/home/randy-vollrath/ticketless-chicago/lib/lob-service.ts`

### Configuration
```typescript
LOB_API_KEY: string (from environment)
Base URL: https://api.lob.com/v1/letters
Auth: Basic HTTP Auth (API key + ":")
```

### sendLetter Function Parameters
```typescript
{
  from: {
    name: string              // User's name
    address: string           // Street address
    city: string
    state: string
    zip: string
  },
  to: {
    name: string             // "City of Chicago - Department of Finance"
    address: string          // "PO Box 88292"
    city: string             // "Chicago"
    state: string            // "IL"
    zip: string              // "60680-1292"
  },
  letterContent: string       // HTML content
  description: string         // "Contest letter for ticket #..."
  metadata: {
    ticket_id: string
    letter_id: string
    user_id: string
  }
}
```

### Lob API Request Body
```json
{
  "description": "Contest letter mailing",
  "to": {
    "name": "City of Chicago - Department of Finance",
    "address_line1": "PO Box 88292",
    "address_city": "Chicago",
    "address_state": "IL",
    "address_zip": "60680-1292",
    "address_country": "US"
  },
  "from": {
    "name": "[User name]",
    "address_line1": "[User address]",
    "address_city": "[City]",
    "address_state": "[State]",
    "address_zip": "[Zip]",
    "address_country": "US"
  },
  "file": "[HTML content]",
  "color": false,
  "double_sided": false,
  "metadata": { ... }
}
```

### Response Mapping
Lob returns:
```typescript
{
  id: string                    // Lob letter ID
  url: string                   // PDF download URL
  tracking_number: string       // USPS tracking number
  expected_delivery_date: string // ISO date string
}
```

### Letter HTML Formatting
- Escaped HTML entities
- Line breaks converted to `<br>`
- Optional signature image support
- Standard margins: 1 inch
- Font: Arial, 12pt
- Line height: 1.5

---

## 6. Conditions for Mailing

A letter will be mailed when **ALL** of these conditions are met:

1. **Letter exists** in `contest_letters` table
2. **Associated ticket exists** in `detected_tickets` table
3. **Ticket status** is one of: `'pending_evidence'`, `'approved'`, `'draft'`
4. **Test ticket?** NO (`is_test = false`)
5. **Evidence deadline passed** (`evidence_deadline <= NOW`)
6. **Kill switch inactive** (`pause_all_mail` is not enabled)
7. **LOB_API_KEY configured** (environment variable set)
8. **User has mailing address** in `user_profiles`
9. **Cron trigger** (daily at 3:00 PM UTC via Vercel)

---

## 7. Kill Switches & Conditions

### Kill Switches (autopilot_admin_settings table)

| Setting | Column | Effect |
|---------|--------|--------|
| `pause_all_mail` | `value.enabled = true` | All mailing stopped gracefully |
| (letter generation) | `kill_all_mailing` or `maintenance_mode` | Letter generation stopped |

### Test Ticket Exclusion
```typescript
if (ticket.is_test) {
  console.log(`Skipping test ticket ${ticket.ticket_number}`)
  return false
}
```
- Letters for test tickets are never sent
- Allows testing without real mail

---

## 8. Complete Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ VA Uploads CSV with Ticket Data                              │
│ (POST /api/admin/autopilot/upload-results)                  │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Parse CSV & Validate                                      │
│    - Normalize violation types                               │
│    - Verify monitored plates exist                           │
│    - Check for duplicates                                    │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Create Ticket in detected_tickets                         │
│    - status: 'pending_evidence'                              │
│    - evidence_deadline: NOW + 72 HOURS                       │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Generate Contest Letter in contest_letters               │
│    - Select defense template by violation_type               │
│    - Populate with user/ticket details                       │
│    - status: 'pending_evidence'                              │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Email User Evidence Request                               │
│    - Deadline: evidence_deadline                             │
│    - Questions specific to violation type                    │
│    - reply-to: evidence@autopilotamerica.com                │
└────────────┬────────────────────────────────────────────────┘
             │
      ┌──────┴──────┐
      │ 72 hours    │
      │ passes...   │
      ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Daily Cron: autopilot-mail-letters.ts                    │
│    - Time: 3:00 PM UTC (vercel.json)                        │
│    - Check kill switches                                     │
│    - Find letters ready to mail:                             │
│      status IN ('pending_evidence','approved','draft')       │
│      AND evidence_deadline <= NOW                            │
│      AND NOT is_test                                         │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. For Each Ready Letter:                                    │
│    a. Get user profile for mailing address                   │
│    b. Call sendLetter() with Lob API                         │
│    c. Update letter: status='mailed', lob_letter_id, PDF URL│
│    d. Update ticket: status='mailed'                         │
│    e. Increment user's letters_used_this_period              │
│    f. Send "letter mailed" notification email                │
└────────────┬────────────────────────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────────────────────────┐
│ 7. Lob.com Processing                                        │
│    - Prints letter (B&W, single-sided)                       │
│    - Mails via USPS                                          │
│    - Provides tracking number                                │
│    - Expected delivery: 3-5 business days                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 9. LOB_API_KEY References

### Files Using LOB_API_KEY

1. **lib/lob-service.ts** (line 47)
   - Check if configured
   - Base64 encode for HTTP Basic Auth
   - Used in fetch headers: `Authorization: Basic ${base64(key + ':')}`

2. **pages/api/cron/autopilot-mail-letters.ts** (line 344)
   - Check if configured before processing
   - Returns 500 error if missing
   - Only check, doesn't directly use (lib/lob-service.ts uses it)

3. **pages/api/stripe-webhook.ts**
   - Reference found but context unknown

### Where to Set
- Environment variable: `LOB_API_KEY`
- Should be Lob.com production API key
- Required for mailing to work

---

## 10. Summary of Key Files

| File | Purpose | Cron? | Key Function |
|------|---------|-------|---|
| upload-results.ts | VA CSV upload & ticket creation | No | Parse CSV, create tickets, generate letters, email user |
| autopilot-generate-letters.ts | Generate letters for found tickets | No | Create letter records, check approval settings |
| autopilot-mail-letters.ts | Mail ready letters via Lob | YES (3PM UTC) | Find ready letters, call Lob API, update status |
| lob-service.ts | Lob.com API integration | No (library) | HTTP request to Lob API, format HTML |

---

## 11. Testing Considerations

- **Test Flag**: Use `is_test = true` on detected_tickets to prevent mailing
- **Kill Switch**: Set `pause_all_mail` to true to pause without changing code
- **Manual Trigger**: POST to `/api/admin/autopilot/upload-results` with CSV
- **Monitor**: Check `ticket_audit_log` and `contest_letters` table for status

---

## 12. Potential Issues & Solutions

| Issue | Symptom | Solution |
|-------|---------|----------|
| LOB_API_KEY missing | 500 error in logs | Set LOB_API_KEY environment variable |
| User missing address | Letters skipped | User must update profile with mailing address |
| Kill switch enabled | No letters mailed | Check autopilot_admin_settings for pause_all_mail |
| Duplicate ticket | Ticket skipped | Check detected_tickets for existing ticket_number |
| Test ticket | Letter not mailed | Check is_test flag on detected_tickets |
| Evidence deadline not set | Letters not mailing | Ensure evidence_deadline is set when ticket created |
| Approval required | Letter in pending_approval | User must approve or setting changed |

