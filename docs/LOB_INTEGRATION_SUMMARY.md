# Lob Integration - Executive Summary

## Complete Flow: VA CSV Upload → Contest Letter Mailed

### Phase 1: Upload & Detection (Manual, via Admin)
**Endpoint**: `POST /api/admin/autopilot/upload-results`
**File**: `pages/api/admin/autopilot/upload-results.ts`

VA admin uploads CSV with ticket data:
```
last_name, first_name, plate, state, user_id, ticket_number, violation_code, violation_type, violation_date, amount
```

For each ticket found:
1. **Verify** monitored plate exists in system
2. **Check** ticket is not duplicate
3. **Create** `detected_tickets` record
   - Status: `pending_evidence`
   - Evidence deadline: NOW + 72 hours
4. **Generate** contest letter from template
   - Template selected by violation_type
   - Customized with user/ticket details
5. **Email** user asking for evidence
   - Reply to: `evidence@autopilotamerica.com`
   - Deadline: 72 hours
   - Specific questions for their violation type

### Phase 2: Wait for Evidence (User Action)
Users can reply to evidence email with supporting documents (optional).
Deadline is fixed: 72 hours from upload.

### Phase 3: Automatic Mailing (Cron Job)
**Endpoint**: `GET /api/cron/autopilot-mail-letters`
**File**: `pages/api/cron/autopilot-mail-letters.ts`
**Schedule**: Daily at 3:00 PM UTC (vercel.json)

Runs automatically once per day:

1. **Check LOB_API_KEY** is configured
   - If missing: return 500 error
   - Required for Lob API calls

2. **Check kill switches**
   - `pause_all_mail` enabled? → skip gracefully
   - Allows admin to pause without code changes

3. **Find ready letters** WHERE:
   - Status is one of: `pending_evidence`, `approved`, `draft`
   - Evidence deadline has passed (NOW >= deadline)
   - NOT a test ticket

4. **For each ready letter**:
   - Get user profile (verify mailing address exists)
   - Call Lob API to mail letter
   - Update database: mark as `mailed`
   - Send user notification email
   - Increment user's letter count

### Phase 4: Lob.com Processing
**Library**: `lib/lob-service.ts`

Lob.com receives request and:
1. Prints letter (black & white, single-sided)
2. Places in envelope
3. Sends via USPS
4. Returns tracking number
5. Expected delivery: 3-5 business days

---

## Critical Conditions for Mailing

ALL of these must be true for a letter to be mailed:

1. **LOB_API_KEY** is set in environment
2. **pause_all_mail** kill switch is NOT enabled
3. **Letter exists** in database
4. **Ticket exists** and is linked to letter
5. **Evidence deadline has passed** (NOW >= deadline)
6. **Not a test ticket** (is_test = false)
7. **User has mailing address** on file
8. **Cron runs** (3:00 PM UTC daily via Vercel)

If any condition is false, the letter will NOT be mailed.

---

## Kill Switches (Emergency Stops)

### pause_all_mail
Location: `autopilot_admin_settings` table
Effect: Stops all mailing gracefully (returns 200 OK)
How to use:
```sql
INSERT INTO autopilot_admin_settings (key, value)
VALUES ('pause_all_mail', '{"enabled": true}')
```

### is_test flag
Location: `detected_tickets.is_test = true`
Effect: Individual ticket won't be mailed
How to use:
```sql
UPDATE detected_tickets SET is_test = true WHERE ticket_number = '...'
```

### Evidence deadline
Location: `detected_tickets.evidence_deadline`
Effect: Letter won't mail until deadline passes
How to use:
```sql
UPDATE detected_tickets SET evidence_deadline = NULL WHERE ...
```

---

## LOB_API_KEY References

**Files that use/check LOB_API_KEY**:
1. `lib/lob-service.ts` (line 47-52)
   - Checks if configured
   - Creates HTTP Basic Auth header
   - Sends to Lob API

2. `pages/api/cron/autopilot-mail-letters.ts` (line 343-350)
   - Checks if configured
   - Returns 500 error if missing

3. `pages/api/stripe-webhook.ts`
   - Reference found (context unclear)

**Where to set**:
- Environment variable: `LOB_API_KEY`
- Value: Your Lob.com API key
- Required for production mailing

---

## Database Tables Involved

| Table | Purpose |
|-------|---------|
| `detected_tickets` | Store ticket info, track status |
| `contest_letters` | Store letter content, Lob tracking |
| `monitored_plates` | Verify plate is monitored |
| `user_profiles` | Get mailing address |
| `autopilot_settings` | User preferences (auto-mail, approval) |
| `autopilot_subscriptions` | Track letters used (for billing) |
| `autopilot_admin_settings` | Kill switches (pause_all_mail) |
| `ticket_audit_log` | Audit trail of all actions |
| `va_uploads` | Log of VA CSV uploads |

---

## Status Values

### detected_tickets.status
- `pending_evidence` → Awaiting evidence deadline
- `mailed` → Letter successfully mailed
- `failed` → Letter mailing failed
- `needs_approval` → Waiting for user approval
- `found` → Ticket found but no letter yet

### contest_letters.status
- `pending_evidence` → Created, awaiting deadline
- `approved` → Approved by user, ready to mail
- `draft` → Letter generated
- `mailed` → Successfully mailed via Lob
- `failed` → Mailing failed
- `pending_approval` → Awaiting user approval

---

## Email Addresses

| Address | Purpose |
|---------|---------|
| `evidence@autopilotamerica.com` | Users reply with supporting documents |
| `alerts@autopilotamerica.com` | System sends notifications from |
| `randyvollrath@gmail.com` | Admin receives upload error notifications |

---

## Timeline of a Ticket

```
TIME                    ACTION                          STATUS
─────────────────────────────────────────────────────────────────
T=0 (Upload)           VA uploads CSV                  
T=0                    Ticket created in system        pending_evidence
T=0                    Letter generated                pending_evidence
T=0                    Evidence request email sent     
                       (deadline in 72 hours)

T=72h (Deadline)       Cron runs at 3 PM UTC           (automatic)
                       Checks: is deadline passed?     
                       YES → continues

T=72h+ (Same day)      Lob API called                  
                       Letter printed, enveloped, mailed

T=72h+ (Same day)      Letter marked as mailed         mailed
                       Tracking number stored
                       User notified by email

T=72h+3-5d             USPS delivers letter            
                       to City of Chicago
```

---

## Defense Templates (by Violation Type)

| Violation Type | Defense Strategy | Evidence Questions |
|---|---|---|
| `expired_plates` | Registration recently renewed | Show renewal receipt/confirmation |
| `no_city_sticker` | Sticker purchased but not displayed | Show purchase receipt/confirmation |
| `expired_meter` | Meter malfunction or unclear payment | Show app payment evidence |
| `disabled_zone` | Valid disability placard/plate | Provide disability documentation |
| `street_cleaning` | Unclear/missing/obscured signage | Photo of signage or car location |
| `rush_hour` | Emergency situation | Describe circumstances |
| `fire_hydrant` | Parked 15+ feet away | Photo of parking distance |
| `speed_camera` | Camera error/malfunction | Challenge calibration |
| `red_light_camera` | Already in intersection | Describe circumstances |
| `other_unknown` | General contest | Any supporting documentation |

Each template includes specific evidence questions sent to user.

---

## Common Issues & Solutions

| Problem | Symptom | Solution |
|---------|---------|----------|
| LOB_API_KEY missing | 500 error "Lob API key not configured" | Set LOB_API_KEY environment variable |
| pause_all_mail enabled | No letters mailed, no error shown | Check autopilot_admin_settings table |
| Evidence deadline in future | Letters skipped | Ensure deadline < NOW |
| User missing address | Letters skipped silently | User updates profile on website |
| Test ticket | Letter not mailed | Check is_test flag on detected_tickets |
| Duplicate ticket | Ticket skipped during upload | Check for existing ticket_number |
| No monitored plate | Ticket skipped | Verify plate in monitored_plates table |

---

## Testing Strategy

### To prevent mailing (safe testing):
```sql
-- Option 1: Mark as test
UPDATE detected_tickets SET is_test = true WHERE ticket_number = '...';

-- Option 2: Enable kill switch
INSERT INTO autopilot_admin_settings (key, value) 
VALUES ('pause_all_mail', '{"enabled": true}');

-- Option 3: Set deadline to future
UPDATE detected_tickets SET evidence_deadline = NOW() + INTERVAL '1 month';
```

### To verify mailing worked:
```sql
-- Check letter was mailed
SELECT status, lob_letter_id, letter_pdf_url, mailed_at
FROM contest_letters WHERE ticket_id = '...';

-- Check audit log
SELECT action, details FROM ticket_audit_log 
WHERE ticket_id = '...' 
ORDER BY created_at DESC;

-- Check subscription
SELECT letters_used_this_period FROM autopilot_subscriptions 
WHERE user_id = '...';
```

---

## Documentation Files

- **LOB_INTEGRATION_FLOW.md** - Complete 12-section guide with all details
- **LOB_FLOW_QUICK_REFERENCE.txt** - Single-page reference with key info
- **LOB_CODE_FLOW.md** - Detailed code execution paths with pseudocode
- **LOB_INTEGRATION_SUMMARY.md** - This file, executive summary

---

## Key Takeaways

1. **CSV Upload** → Creates ticket + letter + emails user evidence request
2. **72-hour wait** → User can send evidence via email reply
3. **Daily cron** → Checks if deadline passed, then mails via Lob
4. **Multiple kill switches** → pause_all_mail, is_test, evidence_deadline
5. **LOB_API_KEY** → Must be set to mail letters
6. **Audit trail** → All actions logged to ticket_audit_log

