# Letter Generation Pipeline - Complete Analysis

## Critical Issues Found

### 1. Unfilled Placeholders in Letters
**Problem**: Letters are being mailed with `[PLACEHOLDER]` brackets that should be filled with actual data.

**Root Causes**:

#### A. Template Placeholders Not Filled by Claude AI
- **Location**: `/pages/api/cron/autopilot-generate-letters.ts` lines 1405-1432
- Contest kit templates contain placeholders like:
  - `[SIGNAGE_ISSUE]`
  - `[SPECIFIC_SIGNAGE_PROBLEM]`
  - `[EVIDENCE_REFERENCE]`
  - `[STICKER_STATUS]`
  - `[PAYMENT_METHOD]`
  - etc.

**The Flow**:
1. Contest kit evaluation (policy-engine.ts) fills SOME placeholders:
   - `[TICKET_NUMBER]` → actual ticket number
   - `[DATE]` → violation date
   - `[LOCATION]` → ticket location
   - `[AMOUNT]` → fine amount
   - `[WEATHER_CONDITION]` → weather data (if applicable)

2. But **keeps others as-is** with comment "Keep as-is for LLM to fill" (line 435)

3. Claude AI receives the **partially-filled template** in the prompt (lines 822-843):
```
ARGUMENT TEMPLATE TO FOLLOW:
${kit.filledArgument}
```

4. **THE PROBLEM**: The prompt says:
   - Line 843: "Fill in any remaining placeholders with the ticket facts"
   - Line 1177: "CRITICAL: Do NOT include any placeholder text like [YOUR NAME] or [DETAILS]. Use the actual data provided above"

5. **But Claude doesn't always fill them** — it sometimes returns the template with placeholders intact.

6. **NO validation** before mailing — the letter goes straight to Lob with unfilled brackets.

#### B. Wrong Dates Getting Into Letters
**Location**: `/pages/api/cron/autopilot-generate-letters.ts` lines 186-188, 781-783

Two date formatting paths exist:

**Path 1: Approval Email** (lines 186-188)
```typescript
const violationDate = ticket.violation_date
  ? new Date(ticket.violation_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  : 'Unknown date';
```

**Path 2: Claude Prompt** (lines 781-783)
```typescript
const violationDate = ticket.violation_date
  ? new Date(ticket.violation_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  : 'the date indicated';
```

**The Issue**:
- The `ticket.violation_date` field comes from the portal scraper (`lib/chicago-portal-scraper.ts`)
- Date parsing from portal HTML may be incorrect
- No validation that the parsed date is correct
- No user confirmation step for violation dates
- Claude receives the date as-is and puts it in the letter

---

## Complete Letter Generation Flow

### Entry Point: `/pages/api/cron/autopilot-generate-letters.ts`

**Trigger**: Cron job or API call with auth
**Schedule**: Not specified in code (configured in Vercel)

### Step 1: Kill Switch Check (lines 282-298)
```typescript
checkKillSwitches()
```
- Checks `autopilot_admin_settings` table
- Stops if `kill_all_mailing` or `maintenance_mode` enabled

### Step 2: Fetch Tickets (lines 1546-1551)
```sql
SELECT * FROM detected_tickets
WHERE status = 'found'
ORDER BY found_at ASC
LIMIT 20
```

### Step 3: For Each Ticket → `processTicket()` (lines 1265-1516)

#### 3.1 Get User Profile (lines 1269-1289)
- Fetches `user_profiles` for mailing address
- **Stops if missing**: `full_name`, `mailing_address`

#### 3.2 Get User Settings (lines 1291-1304)
- Fetches `autopilot_settings`
- Determines if approval required

#### 3.3 Check FOIA Wait Preference (lines 1326-1370)
- If user preference is `wait_for_foia`:
  - Checks `ticket_foia_requests` table
  - Counts business days since FOIA sent
  - **Waits** if <5 business days AND no response yet
  - Proceeds if deadline expired OR city responded

#### 3.4 Gather ALL Evidence (lines 1376-1377)
```typescript
const evidence = await gatherAllEvidence(ticket, violationCode);
```

**Evidence Sources** (lines 306-764):
1. **GPS Parking Evidence** → `lookupParkingEvidence()`
2. **Historical Weather** → `getHistoricalWeather()` (for ALL violation types, not just street cleaning)
3. **City Sticker Receipt** → `city_sticker_receipts` table
4. **Registration Evidence** → `registration_evidence_receipts` table
5. **Red Light Camera Data** → `red_light_receipts` table
6. **Speed Camera Pass History** → `camera_pass_history` table
7. **FOIA Contest Outcomes** → `contested_tickets_foia` table (1.18M records)
8. **Contest Kit Evaluation** → `evaluateContest()` from policy engine
9. **Street Cleaning Schedule** → `street_cleaning_schedule` table
10. **Google Street View** → `getCachedStreetView()` (with AI analysis)
11. **311 Service Requests** → `get311Evidence()` (city's own records)
12. **Expanded Weather Defense** → `getExpandedWeatherDefense()`
13. **Construction Permits** → `getConstructionPermits()`
14. **Officer Intelligence** → `getOfficerIntelligence()` (dismissal rate tracking)
15. **Location Pattern** → `getLocationPatternForAddress()` (cross-user analysis)
16. **FOIA Request Status** → `ticket_foia_requests` table

**All evidence lookups run in parallel** (line 761)

#### 3.5 Build Claude AI Prompt (lines 772-1181)

**The prompt has 13+ sections**:
1. Core ticket facts (lines 788-806)
2. Ordinance details (lines 808-817)
3. **Contest Kit Guidance** (lines 820-844) — **THIS IS WHERE TEMPLATES COME FROM**
4. GPS parking evidence (lines 846-876)
5. Weather data (lines 878-912)
6. City sticker receipt (lines 915-926)
7. Registration receipt (lines 928-941)
8. Red light camera data (lines 943-960)
9. Speed camera GPS data (lines 963-983)
10. FOIA contest outcomes (lines 985-1005)
11. Street View signage evidence (lines 1007-1031)
12. 311 service requests (lines 1034-1053)
13. Expanded weather defense (lines 1056-1068)
14. Construction permits (lines 1071-1083)
15. Officer intelligence (lines 1086-1099)
16. Location pattern (lines 1101-1113)
17. FOIA evidence request status (lines 1126-1148)
18. **Final instructions** (lines 1151-1179)

**Key Instruction** (line 1177):
```
CRITICAL: Do NOT include any placeholder text like [YOUR NAME] or [DETAILS]. Use the actual data provided above
```

#### 3.6 Call Claude AI (lines 1405-1432)
```typescript
const message = await anthropic.messages.create({
  model: 'claude-3-5-sonnet-20241022',
  max_tokens: 2048,
  messages: [{ role: 'user', content: prompt }],
});
```

**Fallback** if Claude fails or `ANTHROPIC_API_KEY` not set:
- Uses `generateFallbackLetter()` (lines 1186-1261)
- Much simpler template with basic evidence paragraphs

#### 3.7 Save Letter (lines 1435-1451)
```typescript
INSERT INTO contest_letters (
  ticket_id, user_id, letter_content, defense_type, status,
  evidence_integrated, street_view_exhibit_urls, ...
)
```

**Status values**:
- `pending_approval` if user requires approval
- `draft` if auto-mail enabled

#### 3.8 Update Ticket (lines 1459-1472)
```typescript
UPDATE detected_tickets
SET status = 'needs_approval' OR 'letter_generated'
    street_view_url = ...,
    street_view_date = ...
```

#### 3.9 Audit Log (lines 1475-1500)
Logs all evidence sources used

#### 3.10 Send Approval Email (lines 1505-1513)
If `needsApproval` AND user has email:
- Sends email with letter preview
- Approve/Skip buttons (JWT tokens)

---

## Letter Mailing Flow

### Entry Point: `/pages/api/cron/autopilot-mail-letters.ts`

**Trigger**: Cron job or API call
**Fetches** (lines 454-479):
```sql
SELECT * FROM contest_letters
WHERE status IN ('approved', 'pending_evidence', 'draft', 'ready', 'awaiting_consent')
-- Joins detected_tickets for evidence_deadline, auto_send_deadline
```

**Filters to ready letters** (lines 491-527):
1. `status = 'approved'` → user clicked approval link
2. `ticket.status = 'approved'` → safety net triggered
3. Auto-send: `evidence_deadline <= now()` (Day 17)
4. Skips test tickets

**For each ready letter** (lines 544-688):

1. **Get user profile** (lines 546-556)
2. **AUTHORIZATION GATE** (lines 559-567):
   - **BLOCKS if no `contest_consent`** (no e-signature)
   - Updates letter status to `awaiting_consent`
3. **Extract user evidence images** (lines 577-603):
   - Parses `detected_tickets.user_evidence` JSON
   - Filters to image URLs only (not PDFs)
4. **Call `mailLetter()`** (lines 605-610)

### `mailLetter()` Function (lines 74-209)

#### 4.1 Build Addresses (lines 84-104)
```typescript
from = user's mailing address (sender)
to = CHICAGO_PARKING_CONTEST_ADDRESS (recipient)
  OR user's address if LOB_TEST_MODE=true
```

#### 4.2 Format Letter as HTML (lines 113-118)
```typescript
formatLetterAsHTML(letterText, {
  evidenceImages: evidenceImages,
  streetViewImages: letter.street_view_exhibit_urls,
  streetViewDate: letter.street_view_date,
  streetViewAddress: letter.street_view_address,
})
```

**HTML formatting** (`/lib/lob-service.ts` lines 153-271):
- Converts plain text to HTML with `<br>` tags
- Adds Street View images as "Exhibit A" (4 directional photos)
- Adds user evidence images as "Exhibit B" (max 5)
- Adds page breaks for exhibits

#### 4.3 Send via Lob API (lines 128-139)
```
POST https://api.lob.com/v1/letters
{
  to: City of Chicago address,
  from: User's address,
  file: HTML content,
  color: false,
  double_sided: false,
  use_type: 'operational',
  metadata: { ticket_id, letter_id, user_id }
}
```

#### 4.4 Update Records (lines 144-160)
```typescript
UPDATE contest_letters
SET status = 'sent',
    lob_letter_id = result.id,
    letter_pdf_url = result.url,
    tracking_number = result.tracking_number,
    mailed_at = NOW(),   // ← THIS IS THE CRITICAL LINE
    sent_at = NOW()

UPDATE detected_tickets
SET status = 'mailed'
```

**THE KEY LINE**: `mailed_at: new Date().toISOString()` (line 151)

This is where `mailed_at` gets set. **There is no other place in the codebase that sets this field.**

---

## Contest Kit Template System

### Location: `/lib/contest-kits/`

**Core Files**:
1. `types.ts` — Type definitions
2. `policy-engine.ts` — Evaluation logic
3. `index.ts` — Kit registry
4. Individual kit files (e.g., `street-cleaning.ts`, `city-sticker.ts`)

### Template Structure

Each kit has:
```typescript
arguments: {
  primary: ArgumentTemplate,      // Best argument (highest win rate)
  secondary: ArgumentTemplate,    // Backup
  fallback: ArgumentTemplate,     // Generic
  situational?: ArgumentTemplate[] // Conditional
}
```

**ArgumentTemplate** (from `types.ts`):
```typescript
{
  id: string,
  name: string,
  template: string,  // ← Contains [PLACEHOLDER] syntax
  requiredFacts: string[],
  winRate: number,   // From FOIA data
  conditions?: ArgumentCondition[],
  supportingEvidence: string[],
  category: 'procedural' | 'signage' | 'emergency' | 'weather' | ...
}
```

### Template Filling Process

**Step 1: Policy Engine** (`policy-engine.ts` line 393-441)
```typescript
function fillArgumentTemplate(arg: ArgumentTemplate, context: ArgumentContext): string {
  let filled = arg.template;

  // Replace KNOWN placeholders
  const replacements: Record<string, string> = {
    '[TICKET_NUMBER]': ticketFacts.ticketNumber || '[TICKET NUMBER]',
    '[DATE]': ticketFacts.ticketDate || '[DATE]',
    '[LOCATION]': ticketFacts.location || '[LOCATION]',
    '[LICENSE_PLATE]': '[YOUR LICENSE PLATE]', // ← NEVER filled!
    '[AMOUNT]': `$${ticketFacts.amount || 0}`,
    '[USER_GROUNDS]': context.selectedGrounds.map(...).join(...) || '• [Your contest grounds]',
  };

  // Weather-specific
  if (weatherDefense?.data) {
    replacements['[WEATHER_CONDITION]'] = weatherDefense.data.weatherDescription;
    replacements['[WEATHER_DATA]'] = weatherDefense.paragraph || '';
    // ...
  }

  // Generic placeholders that need user input — KEPT AS-IS
  const userInputPlaceholders = [
    '[SIGNAGE_ISSUE]', '[SPECIFIC_SIGNAGE_PROBLEM]', '[EVIDENCE_REFERENCE]',
    '[PERMIT_NUMBER]', '[ZONE_NUMBER]', '[PERMIT_LOCATION]', '[PERMIT_EXPIRATION]',
    '[STICKER_STATUS]', '[REGISTRATION_ADDRESS]', '[MALFUNCTION_DESCRIPTION]',
    '[PAYMENT_METHOD]', '[PAYMENT_TIME]', '[PAYMENT_EXPIRATION]', '[TICKET_TIME]',
    '[TIME_COMPARISON]', '[SUPPORTING_INFO]', '[WEATHER_CONTEXT]',
  ];

  // Apply known replacements
  for (const [placeholder, value] of Object.entries(replacements)) {
    filled = filled.replace(...);
  }

  // Mark remaining placeholders as needing user input
  // ← DOES NOTHING — just leaves them as-is "for LLM to fill"

  return filled;
}
```

**Step 2: Claude AI** (receives the partially-filled template)
```
ARGUMENT TEMPLATE TO FOLLOW:
I respectfully contest this citation on the grounds that [SIGNAGE_ISSUE].

The street cleaning signage at 123 Main St was [SPECIFIC_SIGNAGE_PROBLEM].

[EVIDENCE_REFERENCE]
```

Claude is **supposed to**:
- Replace `[SIGNAGE_ISSUE]` with "inadequate signage" or similar
- Replace `[SPECIFIC_SIGNAGE_PROBLEM]` with actual description
- Replace `[EVIDENCE_REFERENCE]` with "Attached photos show..."

**But sometimes Claude**:
- Returns the template verbatim with placeholders
- Doesn't understand that brackets need to be filled
- Fills some but not all

**Step 3: No Validation**
- Letter saved to DB as-is
- No check for remaining `[...]` placeholders
- Mailed directly to city with unfilled brackets

---

## Specific Defense Kit Examples

### Street Cleaning Kit (`street-cleaning.ts`)

**Primary Argument Template** (lines 146-152):
```
I respectfully contest this citation on the grounds that the street cleaning signage at [LOCATION] was [SIGNAGE_ISSUE].

Chicago Municipal Code requires that street cleaning signs be clearly visible and posted at regular intervals not exceeding 500 feet. Upon inspection of the location where my vehicle was parked, I found that [SPECIFIC_SIGNAGE_PROBLEM].

[EVIDENCE_REFERENCE]

Without adequate notice of the street cleaning restrictions, motorists cannot reasonably be expected to comply with parking prohibitions. I respectfully request that this citation be dismissed.
```

**Placeholders that must be filled**:
- `[LOCATION]` → Filled by policy engine
- `[SIGNAGE_ISSUE]` → **Expected Claude to fill**
- `[SPECIFIC_SIGNAGE_PROBLEM]` → **Expected Claude to fill**
- `[EVIDENCE_REFERENCE]` → **Expected Claude to fill**

### City Sticker Kit (`city-sticker.ts`)

**Primary Argument Template** (lines 140-150):
```
I respectfully contest this citation on the grounds that a valid City of Chicago vehicle sticker was properly displayed on my vehicle at the time this citation was issued.

My vehicle (License Plate: [LICENSE_PLATE]) had a current, valid city sticker affixed to the lower-left corner of the windshield as required by Chicago Municipal Code. The sticker was [STICKER_STATUS].

[EVIDENCE_REFERENCE]
```

**Placeholders**:
- `[LICENSE_PLATE]` → **NEVER filled** (policy engine sets to `'[YOUR LICENSE PLATE]'`)
- `[STICKER_STATUS]` → **Expected Claude to fill**
- `[EVIDENCE_REFERENCE]` → **Expected Claude to fill**

---

## Why Placeholders Aren't Filled

### Design Flaw 1: Two-Stage Filling
The system tries to fill templates in **two stages**:
1. Policy engine fills "basic" facts (ticket number, date, location)
2. Claude AI fills "contextual" facts (signage issues, sticker status, evidence descriptions)

**Problem**: Claude doesn't always understand it needs to fill brackets.

### Design Flaw 2: No Validation
After Claude returns the letter:
- **No regex check** for remaining `[...]` patterns
- **No LLM call** to verify all placeholders filled
- **No human review** before mailing (unless user has approval enabled)

### Design Flaw 3: Incomplete Data
Some placeholders can't be filled because the data doesn't exist:
- `[LICENSE_PLATE]` — Ticket has plate number but policy engine doesn't use it
- `[SIGNAGE_ISSUE]` — Requires Street View analysis (which exists!) but isn't fed to policy engine
- `[STICKER_STATUS]` — Requires receipt data (which exists!) but isn't connected to template

---

## Date Issues

### Where Violation Dates Come From

**Path 1: Portal Scraper** (`lib/chicago-portal-scraper.ts`)
- Scrapes Chicago payment portal HTML
- Parses violation date from table cells
- **No validation** of parsed date
- Stores raw string in `detected_tickets.violation_date`

**Path 2: Email Forwarding** (`pages/api/webhooks/resend-incoming-email.ts`)
- User forwards ticket email
- OCR extracts date from image
- **No validation** of extracted date

**Path 3: Manual Entry** (various ticket upload endpoints)
- User types date
- **No validation** beyond basic format

### Date Formatting in Letter

**Two formatters exist**:
1. Approval email: `month: 'long', day: 'numeric', year: 'numeric'`
2. Claude prompt: `year: 'numeric', month: 'long', day: 'numeric'`

**Same underlying data**, different order.

**No checks for**:
- Date in the future
- Date more than 21 days ago (contest deadline)
- Date doesn't match ticket number format
- Date is obviously wrong (e.g., Feb 30)

---

## Why `mailed_at` Might Not Update

**The ONLY place `mailed_at` is set**: `/pages/api/cron/autopilot-mail-letters.ts` line 151

```typescript
await supabaseAdmin
  .from('contest_letters')
  .update({
    status: 'sent',
    lob_letter_id: result.id,
    letter_pdf_url: result.url,
    tracking_number: result.tracking_number,
    mailed_at: new Date().toISOString(),  // ← HERE
    sent_at: new Date().toISOString(),
  })
  .eq('id', letter.id);
```

**If `mailed_at` is null, one of these happened**:
1. **Lob API failed** (lines 184-208):
   - Error thrown before update
   - Letter status set to `'failed'`
   - Update block never runs
2. **Supabase update failed**:
   - Network error
   - RLS policy blocked update
   - Database constraint violation
3. **Letter was never actually mailed**:
   - Still in `draft`, `pending_approval`, or `awaiting_consent` status
   - Filtered out by ready letter logic (lines 491-527)

**No logging** if the update fails silently.

---

## Recommendations to Fix

### 1. Placeholder Validation
**Add before mailing**:
```typescript
function validateNoPlaceholders(letterContent: string): { valid: boolean; placeholders: string[] } {
  const regex = /\[([A-Z_]+)\]/g;
  const matches = letterContent.match(regex) || [];
  return {
    valid: matches.length === 0,
    placeholders: matches
  };
}
```

**Block mailing if placeholders remain**:
```typescript
const validation = validateNoPlaceholders(letterContent);
if (!validation.valid) {
  // Set letter status to 'needs_review'
  // Alert admin
  // Do NOT mail
}
```

### 2. Fill All Placeholders Before Sending to Claude
Don't rely on Claude to fill structural data. Fill everything the system knows:

```typescript
replacements['[LICENSE_PLATE]'] = ticket.plate || '[PLATE]';
replacements['[SIGNAGE_ISSUE]'] = evidence.streetViewPackage?.hasSignageIssue
  ? 'inadequate and obscured'
  : 'not clearly visible';
replacements['[STICKER_STATUS]'] = evidence.cityStickerReceipt
  ? `purchased on ${evidence.cityStickerReceipt.purchase_date}`
  : 'displayed as required';
// etc.
```

**Pass to Claude only if placeholders remain** that truly need human-like description.

### 3. Date Validation
**At ingestion time**:
```typescript
function validateViolationDate(dateString: string, ticketNumber: string): boolean {
  const date = new Date(dateString);
  const now = new Date();

  // Check not in future
  if (date > now) return false;

  // Check not more than 90 days ago (reasonable limit)
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  if (date < ninetyDaysAgo) return false;

  // Check ticket number date prefix matches (if applicable)
  // Chicago tickets start with YYYYMMDD
  if (ticketNumber.length >= 8) {
    const ticketDatePrefix = ticketNumber.substring(0, 8);
    const parsedDate = dateString.replace(/-/g, '');
    if (!parsedDate.startsWith(ticketDatePrefix)) {
      console.warn('Date mismatch: ticket number suggests different date');
      return false;
    }
  }

  return true;
}
```

### 4. Add Mailing Transaction Log
**Track every mailing attempt**:
```sql
CREATE TABLE letter_mailing_attempts (
  id UUID PRIMARY KEY,
  letter_id UUID REFERENCES contest_letters,
  attempted_at TIMESTAMPTZ,
  lob_response JSONB,
  success BOOLEAN,
  error_message TEXT
);
```

**Log both success and failure**:
```typescript
await supabaseAdmin.from('letter_mailing_attempts').insert({
  letter_id: letter.id,
  attempted_at: new Date().toISOString(),
  lob_response: result,
  success: true,
  error_message: null
});
```

### 5. Claude Prompt Improvement
**Add explicit examples**:
```
CRITICAL INSTRUCTIONS FOR FILLING PLACEHOLDERS:

You will see text in brackets like [SIGNAGE_ISSUE]. These are placeholders you MUST replace with actual descriptions based on the evidence provided.

Examples:
- [SIGNAGE_ISSUE] → "inadequate and obscured by tree branches"
- [SPECIFIC_SIGNAGE_PROBLEM] → "the nearest street cleaning sign was 800 feet away, exceeding the 500-foot maximum spacing required by code"
- [EVIDENCE_REFERENCE] → "Attached photographs (Exhibits A-D) show the signage conditions at the location"

DO NOT leave any text in brackets. Replace ALL placeholders with actual descriptions.
```

### 6. Add Human Review Flag
**For high-risk situations**:
```typescript
const needsHumanReview =
  validation.placeholders.length > 0 ||  // Unfilled placeholders
  !validateViolationDate(ticket.violation_date, ticket.ticket_number) ||  // Date issue
  letterContent.includes('the date indicated') ||  // Generic date fallback
  letterContent.length < 500;  // Suspiciously short

if (needsHumanReview) {
  await supabaseAdmin.from('contest_letters').update({
    status: 'needs_review',
    review_reason: 'Automated quality checks failed'
  }).eq('id', letter.id);
}
```

---

## Evidence Integration Quality

**The system has EXCELLENT evidence**:
- GPS parking departure proof
- Historical weather data
- Street View imagery with AI analysis
- 311 service requests
- FOIA contest outcome data (1.18M records)
- Construction permits
- Officer dismissal rate tracking
- Location pattern analysis

**All of this makes it into the Claude prompt** (lines 772-1181).

**But**:
- Evidence doesn't make it into the **template placeholders**
- Policy engine fills template → Claude receives template → Claude sometimes doesn't use the evidence effectively

**Better approach**:
- Fill templates with evidence FIRST
- Only use Claude for:
  - Connecting evidence to legal arguments
  - Writing compelling narrative
  - Generating closing paragraphs

---

## Summary

### The Letter Generation Pipeline

1. **Cron triggers** `/pages/api/cron/autopilot-generate-letters.ts`
2. **Fetches tickets** with `status = 'found'`
3. **For each ticket**:
   - Gathers 15+ evidence sources in parallel
   - Evaluates contest kit (policy-engine.ts)
   - Fills template with basic facts
   - Builds 1000+ line Claude prompt
   - **Sends to Claude AI** with partially-filled template
   - **Saves response** to `contest_letters` table
   - Sends approval email if needed
4. **Mailing cron** triggers `/pages/api/cron/autopilot-mail-letters.ts`
5. **Fetches ready letters** (approved OR deadline passed)
6. **For each letter**:
   - Formats as HTML with exhibits
   - **Sends to Lob API**
   - **Updates `mailed_at`** (line 151)
   - Sends confirmation email to user

### The Two Critical Bugs

**Bug 1: Unfilled Placeholders**
- Contest kit templates have `[PLACEHOLDER]` syntax
- Policy engine fills some, leaves rest for Claude
- Claude doesn't always fill them
- **No validation** before mailing
- Letters get mailed with `[SIGNAGE_ISSUE]` etc. in the text

**Bug 2: Wrong Dates**
- Violation dates come from portal scraper / OCR / user input
- **No validation** that date is correct
- Date formatting differs between email preview and actual letter
- Date gets baked into letter by Claude
- User has no chance to review/correct before mailing

**Bug 3: `mailed_at` Not Set** (not confirmed, but possible)
- Only set in one place (autopilot-mail-letters.ts line 151)
- If Lob API fails, update never runs
- If Supabase update fails, no logging
- Letter stays in limbo with no `mailed_at`

---

## Files Involved

### Letter Generation
- `/pages/api/cron/autopilot-generate-letters.ts` (1612 lines) — Main generation logic
- `/lib/contest-kits/policy-engine.ts` (600 lines) — Template filling
- `/lib/contest-kits/index.ts` (241 lines) — Kit registry
- `/lib/contest-kits/types.ts` (216 lines) — Type definitions
- `/lib/contest-kits/street-cleaning.ts` (324 lines) — Example kit
- `/lib/contest-kits/city-sticker.ts` — Example kit
- 15+ other kit files

### Letter Mailing
- `/pages/api/cron/autopilot-mail-letters.ts` (713 lines) — Main mailing logic
- `/lib/lob-service.ts` (398 lines) — Lob API integration

### Evidence Sources
- `/lib/parking-evidence.ts` — GPS departure proof
- `/lib/weather-service.ts` — Historical weather
- `/lib/street-view-service.ts` — Google Street View + AI analysis
- `/lib/evidence-enrichment-service.ts` — 311 data, construction permits, expanded weather
- `/lib/contest-outcome-tracker.ts` — Officer intelligence, location patterns

### Supporting
- `/lib/chicago-ordinances.ts` — Ordinance lookup
- `/lib/chicago-portal-scraper.ts` — Portal scraping (date source)
- Database tables: `detected_tickets`, `contest_letters`, `ticket_audit_log`, `autopilot_settings`, `user_profiles`, etc.

---

## Next Steps

1. **Add placeholder validation** before mailing
2. **Fill all known placeholders** in policy engine (don't rely on Claude)
3. **Add date validation** at ingestion time
4. **Improve Claude prompt** with explicit examples
5. **Add mailing transaction log** for debugging
6. **Add human review flag** for quality issues
7. **Test on real tickets** to see current failure rate

The system is **extremely sophisticated** with tons of evidence sources. The bugs are **fixable** with proper validation and better template handling.
