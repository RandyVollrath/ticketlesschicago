# Ticketless Chicago: Ticket Contesting System - Complete End-to-End Analysis

## Executive Summary

The ticket contesting system is a sophisticated, **multi-layer** automated pipeline that discovers parking tickets, generates defense letters, collects evidence, and mails contest letters to the City of Chicago. The system uses browser automation (Playwright) to scrape the Chicago Finance payment portal, integrates evidence guidance based on ticket type, and manages the full contest workflow.

---

## 1. PORTAL SCRAPER - TICKET DISCOVERY

### Location
- **Primary**: `lib/chicago-portal-scraper.ts` (607 lines)
- **Script Runner**: `scripts/autopilot-check-portal.ts` (887 lines)

### How It Works

#### 1a. Portal Access & Navigation
- **URL**: `https://webapps1.chicago.gov/payments-web/#/validatedFlow?cityServiceId=1`
- **Technology**: Playwright headless browser automation (Chromium)
- **Process**:
  1. Launches headless browser with stealth mode (`--disable-blink-features=AutomationControlled`)
  2. Navigates to portal and waits for Angular SPA to bootstrap (8000ms)
  3. Clicks "License Plate" search tab
  4. Fills form fields: plate, state, last name
  5. Force-clicks Search button via JavaScript injection (bypassing hCaptcha)

#### 1b. Captcha Bypass Mechanism
- **Strategy**: Form field injection + button DOM manipulation (no API needed)
- **Process**:
  1. Uses native HTMLInputElement setter to trigger Angular change detection
  2. Dispatches `input` and `change` events with `bubbles: true`
  3. Removes `disabled` attribute from Search button
  4. Calls `button.click()` via JavaScript (not Playwright, avoids overlay interception)
- **Cost**: $0.00 (no captcha API)
- **Fallback**: CapSolver API integration (if city starts validating tokens server-side)
  - Uses `HCaptchaTaskProxyLess` type
  - Polls result every 3 seconds for up to 2 minutes
  - Cost: ~$0.002 per solve (configured via `CAPSOLVER_API_KEY`)

#### 1c. Ticket Data Extraction
- **API Endpoint**: `POST /payments-web/api/searches` (intercepted)
- **Response Parsing**:
  - Status 200: Contains `searchResult.receivables[]` array of tickets
  - Status 422: "No open receivables found" (zero tickets, not an error)
  - Status 500: Server error
  - Status 401: Session expired

#### 1d. Ticket Data Fields
```typescript
interface PortalTicket {
  ticket_number: string;
  ticket_type: 'parking' | 'red_light' | 'speed_camera';
  issue_date: string; // MM/DD/YYYY format
  violation_description: string;
  current_amount_due: number;
  original_amount: number;
  ticket_queue: string; // 'Notice', 'Hearing', 'Determination', etc.
  hearing_disposition: string | null; // 'Liable', 'Not Liable', 'Dismissed'
  notice_number: string | null;
  balance_due: number;
  raw_text: string; // Raw JSON for debugging
}
```

#### 1e. Batch Processing
- **Function**: `lookupMultiplePlates()`
- **Rate Limiting**: 5 second delay between lookups (configurable)
- **Browser Reuse**: Single browser instance for multiple plates (performance optimization)
- **Max Plates**: 50 per run (configurable via `PORTAL_CHECK_MAX_PLATES`)
- **Duration**: ~14 seconds per plate

### Schedule & Configuration
- **Frequency**: Monday & Thursday (2x/week) via systemd user timers
- **Environment Variables**:
  - `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (required)
  - `SUPABASE_SERVICE_ROLE_KEY` - Admin auth key (required)
  - `RESEND_API_KEY` - Email service (required for notifications)
  - `CAPSOLVER_API_KEY` - Captcha fallback (optional)
  - `PORTAL_CHECK_MAX_PLATES` - Max plates per run (default: 50)
  - `PORTAL_CHECK_DELAY_MS` - Delay between lookups (default: 5000)
  - `PORTAL_CHECK_SCREENSHOT_DIR` - Debug screenshots (optional)

---

## 2. AUTOPILOT ORCHESTRATION

### Location
- **Main Script**: `scripts/autopilot-check-portal.ts` (887 lines)
- **Alternative**: `pages/api/cron/autopilot-check-plates.ts` (Chicago Data Portal API)
- **Cron Jobs**: `pages/api/cron/autopilot-*.ts`

### Workflow: Portal Check → Database → Email

#### 2a. Initialization
```
1. Load from Supabase:
   - autopilot_admin_settings (kill switches, triggers)
   - autopilot_subscriptions (active users)
   - monitored_plates (active user plates)
   - user_profiles (names, addresses)

2. Check kill switches:
   - kill_all_checks → exit
   - maintenance_mode → exit
   - portal_check_trigger → manual trigger detected

3. Check active subscriptions:
   - Filter users with status='active' AND authorization_revoked_at IS NULL
```

#### 2b. Ticket Processing Pipeline
For each ticket found:
```
1. Check for duplicates
   - Query detected_tickets WHERE ticket_number = X
   - Skip if exists

2. Skip if resolved
   - hearing_disposition = 'Dismissed'
   - ticket_queue = 'Paid'

3. Parse violation date
   - Convert MM/DD/YY or MM/DD/YYYY to ISO 8601

4. Map violation type
   - Uses VIOLATION_TYPE_MAP (see section 3)

5. Create detected_ticket record
   - table: detected_tickets
   - status: 'pending_evidence'
   - source: 'portal_scrape'
   - evidence_deadline: ticketDate + 17 days (see PRODUCT_DECISIONS.md)

6. Generate contest letter
   - Uses DEFENSE_TEMPLATES (violation-type specific)
   - User profile: name, address, city, state, zip
   - Fallback to DEFAULT_SENDER_ADDRESS if no profile data

7. Create contest_letter record
   - table: contest_letters
   - letter_content: formatted defense letter
   - defense_type: 'registration_challenge', 'sticker_challenge', etc.
   - status: 'pending_evidence'

8. Send evidence request email
   - Evidence guidance HTML (violation-type specific)
   - Quick tips and pitfalls
   - Win rate percentage
   - Evidence deadline
   - Questions for user to answer

9. Audit log
   - Record ticket detection with portal data

10. Admin notification
    - Email to randyvollrath@gmail.com
    - Summary: ticket number, type, amount, user, source
```

#### 2c. Summary & Cleanup
```
Log to ticket_audit_log:
  - plates_checked
  - tickets_found
  - tickets_created
  - tickets_skipped (duplicates)
  - errors
  - captcha_cost
  - timestamp

Update portal_check_trigger flag:
  - status: 'completed'
  - results: {plates_checked, tickets_created, errors, captcha_cost}
  - completed_at: timestamp

Send admin summary email
```

---

## 3. EVIDENCE GUIDANCE SYSTEM

### Location
- `lib/contest-kits/evidence-guidance.ts` (860 lines)

### Coverage: 20+ Ticket Types

Each ticket type has:
- **Win Rate**: 18-75% based on FOIA data
- **Email Subject**: Motivational, highlights win rate
- **Title**: Optimistic heading
- **Intro**: Contextual explanation
- **Questions**: 3-4 highest-impact questions (ordered by impact score)
- **Quick Tips**: What evidence to gather
- **Pitfalls**: What NOT to say
- **Weather Relevance**: Whether weather defense applies
- **Weather Question**: Conditional question if applicable

#### Ticket Types Covered
1. **expired_plates** (75% win rate)
   - Key: Proof of renewal before/shortly after ticket
   - Evidence: IL SOS screenshot, renewal confirmation email, credit card statement

2. **no_city_sticker** (70% win rate)
   - Key: Purchase receipt before ticket date
   - Evidence: City purchase confirmation, card statement, proof of non-residency

3. **expired_meter** (67% win rate)
   - Key: ParkChicago app payment proof
   - Evidence: App screenshot, meter malfunction report, timing analysis

4. **street_cleaning** (34% win rate)
   - Key: Missing/obscured signage + GPS departure proof
   - Evidence: Photos of location, Google Street View, Autopilot GPS data, weather data

5. **fire_hydrant** (44% win rate)
   - Key: Hydrant was obscured or distance was >15 feet
   - Evidence: Photos, snow covering, distance measurements, Google Street View

6. **disabled_zone** (68% win rate)
   - Key: Valid disability placard documentation
   - Evidence: Placard photo, IL SOS registration, medical emergency docs

7. **residential_permit** (54% win rate)
   - Key: Valid permit displayed or visitor pass
   - Evidence: Permit photo, resident statement, zone documentation

8. **red_light** (25% win rate)
   - Key: Already in intersection on yellow or safety emergency
   - Evidence: Violation video review, road conditions, yellow light timing

9. **speed_camera** (20% win rate)
   - Key: Speed limit signage missing or camera malfunction
   - Evidence: Speed limit sign photos, camera calibration records, vehicle verification

10. **snow_route** (30% win rate)
    - Key: Alert not properly announced or signs obscured
    - Evidence: Alert timing, snow-covered signs, out-of-town documentation

11-20. **Additional types**: bus_stop, bike_lane, parking_alley, no_standing_time_restricted, double_parking, commercial_loading, missing_plate, and **other_unknown** (40% catch-all)

### Email Generation
- **HTML Template**: Evidence request with motivation styling
- **Components**:
  - Win rate badge (color-coded: green >50%, orange 30-50%, red <30%)
  - Ticket details table
  - Evidence questions with "Why this matters" explanations
  - Good examples for each question
  - Quick tips section
  - Pitfalls/avoidable mistakes
  - Evidence deadline (Day 17 from ticket issue date)
  - Weather question (if applicable)

### Key Functions
- `getEvidenceGuidance(violationType)` - Get guidance for any ticket type
- `generateEvidenceQuestionsHtml(guidance)` - HTML for email questions
- `generateQuickTipsHtml(guidance)` - HTML for tips section

---

## 4. DATABASE SCHEMA

### Core Tables

#### monitored_plates
```
id (UUID)
user_id (UUID) → auth.users
plate (text)
state (text)
status ('active' | 'inactive')
last_checked_at (timestamp)
created_at (timestamp)
```

#### detected_tickets
```
id (UUID, PK)
user_id (UUID) → auth.users
plate_id (UUID) → monitored_plates
plate (text)
state (text)
ticket_number (text, unique)
violation_code (text)
violation_type (text) - normalized type
violation_description (text)
violation_date (date)
amount (numeric)
location (text)
status ('pending_evidence' | 'evidence_received' | 'letter_sent' | 'resolved')
found_at (timestamp)
source ('portal_scrape' | 'chicago_api' | 'user_upload' | 'manual')
evidence_requested_at (timestamp)
evidence_deadline (timestamp)
raw_data (jsonb) - portal_ticket, scraped_at, etc.
user_evidence (jsonb) - evidence answers from user
created_at (timestamp)
updated_at (timestamp)
```

#### contest_letters
```
id (UUID, PK)
ticket_id (UUID, FK) → detected_tickets
user_id (UUID) → auth.users
letter_content (text) - HTML/formatted version
letter_text (text) - plain text version
defense_type (text) - 'registration_challenge', 'sticker_challenge', etc.
status ('pending_evidence' | 'pending_review' | 'ready_to_mail' | 'mailed' | 'returned')
using_default_address (boolean)
mailed_at (timestamp)
lob_id (text) - Lob.com letter ID
expected_delivery_date (date)
created_at (timestamp)
updated_at (timestamp)
```

#### ticket_audit_log
```
id (UUID)
ticket_id (UUID, FK) → detected_tickets (nullable)
user_id (UUID, nullable)
action (text) - 'ticket_detected', 'evidence_received', 'letter_generated', 'letter_mailed', etc.
details (jsonb) - action-specific data
performed_by (text) - 'portal_scraper', 'user', 'system', etc.
created_at (timestamp)
```

#### autopilot_subscriptions
```
user_id (UUID, PK) → auth.users
stripe_customer_id (text)
stripe_subscription_id (text)
status ('active' | 'canceled' | 'paused')
plan_type (text)
letters_included (numeric) - monthly limit
letters_used_this_period (numeric)
current_period_start (timestamp)
current_period_end (timestamp)
authorization_revoked_at (timestamp) - null = authorized
created_at (timestamp)
updated_at (timestamp)
```

#### autopilot_admin_settings
```
key (text, PK) - unique setting name
value (jsonb) - configuration value
updated_at (timestamp)
```

### Intelligence Tables (for future analysis)
- `ward_contest_intelligence` - Win rates by ward and violation type
- `hearing_officer_patterns` - Officer-specific dismissal rates
- `signage_reports` - Crowd-sourced signage condition reports
- `letter_quality_scores` - Letter effectiveness scoring
- `ticket_outcomes` - Hearing results and appeals
- `evidence_analysis` - Evidence effectiveness analysis

---

## 5. EMAIL NOTIFICATION SYSTEM

### Emails Sent During Portal Check

#### 5a. Evidence Request Email (to user)
**When**: For each ticket detected
**From**: `alerts@autopilotamerica.com`
**Reply-to**: `evidence+{ticket_id}@autopilotamerica.com`
**Subject**: Violation-type specific
**Content**:
- Win rate badge with color coding
- Ticket details table
- Evidence request questions (3-4 per ticket type)
- Quick tips tailored to violation type
- Pitfalls/mistakes to avoid
- Evidence deadline (Day 17 from ticket issue date)
- Optional weather question

**Implementation**: Via Resend API (`RESEND_API_KEY`)

#### 5b. Admin Notification Email (to Randy)
**When**: Each new ticket found
**To**: `randyvollrath@gmail.com`
**Subject**: `New Ticket Found: {number} — {type} (${amount})`
**Content**: Detailed table with:
- User name and email
- Ticket number, amount, violation type
- Violation description and date
- License plate and state
- Status and deadline
- Evidence request email status confirmation

#### 5c. Portal Check Summary Email (to admin)
**When**: After portal check completes
**To**: `randyvollrath@gmail.com`
**Subject**: `Portal Check: {N} new ticket(s) found`
**Content**: Statistics:
- Plates checked
- Total tickets found
- New tickets created
- Duplicates skipped
- Errors encountered
- Captcha cost

### Implementation Details
- **Service**: Resend API (email delivery)
- **Configuration**: `RESEND_API_KEY` environment variable
- **Graceful Degradation**: If key not set, emails skipped but processing continues

---

## 6. LETTER GENERATION & MAILING

### Location
- **Letter Service**: `lib/lob-service.ts`
- **Letter Mailing Cron**: `pages/api/cron/autopilot-mail-letters.ts`
- **Approval Endpoint**: `pages/api/autopilot/approve-letter.ts`

### Workflow

#### 6a. Contest Letter Generation
**When**: During ticket processing (immediately after detection)
**Process**:
1. Get defense template for violation type
2. Parse user profile (name, mailing address)
3. Substitute placeholders:
   - `{ticket_number}`
   - `{violation_date}`
   - `{violation_description}`
   - `{amount}`
   - `{location}`
   - `{plate}`
   - `{state}`
4. Format as formal letter:
   - Today's date
   - User name and address
   - City of Chicago Department of Finance address
   - RE: Contest of Parking Ticket {number}
   - Formal defense body
   - Signature line

#### 6b. Letter Status Workflow
```
pending_evidence
  ↓ (Day 17 deadline passes)
pending_review (user review + evidence collection)
  ↓ (approved by user or auto-approved after deadline)
ready_to_mail
  ↓ (processed by mailing cron)
mailed (sent via Lob.com)
  ↓ (optional)
resolved (hearing outcome recorded)
```

#### 6c. Mailing Process (Lob Integration)
**Service**: Lob.com (physical mail delivery)
**API**: `POST https://api.lob.com/v1/letters`
**Configuration**:
- **From Address**: User's mailing address (appears as sender)
- **To Address**: Chicago Department of Finance (hardcoded)
- **Format**: Black & white, single-sided, operational use type
- **Cost**: ~$0.25-0.35 per letter + postage

**Letter Tracking**:
- Returns `lob_id` (tracking number)
- `expected_delivery_date` (computed)
- Letter mailed and recorded in `contest_letters.mailed_at`

#### 6d. Test Mode
- Environment variable: `LOB_TEST_MODE=true`
- If enabled: Sends letter to user's address instead of City Hall
- Useful for testing before production

### Mail Letter Cron Job
**Location**: `pages/api/cron/autopilot-mail-letters.ts`
**Trigger**: Daily or on-demand
**Process**:
1. Check kill switches
2. Get all letters with status='ready_to_mail'
3. For each letter:
   - Get user profile (mailing address)
   - Get ticket data
   - Get detected_tickets relation
   - Call Lob API to send
   - Update letter status to 'mailed'
   - Record mailed_at timestamp and lob_id
4. Summary report to admin

---

## 7. INTELLIGENCE & ANALYTICS

### Evidence Analysis API
**Endpoint**: `GET/POST /api/intelligence/evidence`
- Analyzes evidence photos/documents submitted by users
- Scores evidence impact on case outcome
- Categorizes evidence: payment_proof, renewal_proof, signage_photo, etc.
- Returns warnings about weak evidence

### Letter Quality Scoring API
**Endpoint**: `GET/POST /api/intelligence/letter-score`
- Scores contest letter quality (1-100)
- Analyzes:
  - Evidence integration (are photos/docs mentioned?)
  - Defense type appropriateness
  - Specific vs. generic language
  - Evidence count and types
- Returns improvement suggestions
- Historical letter scores tracked in `letter_quality_scores` table

### Outcome Tracking
**Table**: `ticket_outcomes`
- Records hearing results (dismissed, upheld, settled)
- Analyzes which evidence types correlate with wins
- Feeds back into evidence guidance system

---

## 8. CRITICAL GAPS & ISSUES

### Gap 1: Batch Processing Lacks Result Feedback Loop
**Issue**: Portal check creates tickets and emails users, but no real-time feedback if emails fail
**Impact**: Users might not receive evidence request email (silent failure)
**Missing**: Retry logic for email failures, email delivery verification

### Gap 2: Evidence Collection Is Unstructured
**Issue**: Evidence request email asks questions but system doesn't capture structured responses
**Flow**:
- Email says "reply to this email with answers"
- Replies to `evidence+{ticket_id}@autopilotamerica.com` (no handler visible)
- No `email_parser.ts` or evidence intake endpoint found
**Missing**: Email parsing pipeline, automated extraction of evidence from user replies

### Gap 3: No Evidence-to-Letter Integration
**Issue**: Letters are generated immediately (before evidence arrives), don't incorporate user evidence
**Current**: Letter is generic defense template
**Should Be**: Letter should reference specific evidence (e.g., "As shown in attached Exhibit A, I have proof of renewal...")
**Missing**: Mechanism to update/regenerate letters after evidence arrives

### Gap 4: Letter Approval Workflow Unclear
**File**: `pages/api/autopilot/approve-letter.ts` (exists but implementation shows basic flow)
**Issue**: No UI/approval interface found for users to review letters before mailing
**Status**: Appears to auto-approve after evidence deadline + send via Lob
**Missing**: User-facing letter review screen, approval checkpoint before physical mailing

### Gap 5: No Departure Tracking Integration
**Issue**: Evidence guidance says "Autopilot app automatically checks GPS records" for street cleaning
**Code**: GPS data collection exists in mobile app, but no endpoint found to:
  - Accept GPS departure data from mobile app
  - Store in `detected_tickets.user_evidence` or separate table
  - Display in evidence collection UI
  - Reference in contest letter
**Missing**: Mobile-to-web integration for GPS evidence

### Gap 6: Weather Data Integration
**Issue**: Evidence guidance mentions "we automatically check weather data" for applicable violations
**Code**: No weather API integration found (no OPENWEATHERMAP_API_KEY reference)
**Missing**: Weather data lookup by ticket date+location, storage in ticket record

### Gap 7: User Profile Defaults
**Issue**: If user has no mailing address, defaults to hardcoded "2434 N Southport Ave"
**Risk**: Letters get mailed to wrong address if profile incomplete
**Missing**: Validation warning before letter creation, prompt for address update

### Gap 8: Duplicate Ticket Detection
**Issue**: Checks `detected_tickets WHERE ticket_number = X` but portal can return same ticket in multiple checks
**Edge Case**: If user has multiple cars/plates, same ticket could be associated with multiple plates
**Missing**: Unique constraint enforcement, better duplicate detection

### Gap 9: No Outcome Recording
**Issue**: System creates and mails letters but doesn't track hearing results
**Missing**:
  - Endpoint to record hearing outcome
  - Link between outcome and letter effectiveness
  - Feedback loop to improve future letters

### Gap 10: Evidence Deadline Not Enforced
**Issue**: [RESOLVED] Evidence deadline unified to Day 17 from ticket date. Letters auto-send on Day 17.
**Process**: Manual or auto-approval unclear
**Missing**: Clear deadline enforcement, user notification before deadline expires

### Gap 11: No Contest Status UI for Users
**Issue**: No web page found where users can see:
  - Tickets found
  - Evidence requests and deadlines
  - Contest letter status (pending review, mailed, outcome)
  - Outcome results
**Exists**: Admin panels exist (`pages/admin/contests.ts`) but no user-facing dashboard

### Gap 12: Mobile App Evidence Collection
**Mentioned**: Mobile app can provide GPS departure, speed data
**Missing**: UI in mobile app to submit evidence to web backend

---

## 9. END-TO-END DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────┐
│                     MONDAY/THURSDAY CRON                         │
│                   autopilot-check-portal.ts                      │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 ▼
    ┌─────────────────────────┐
    │  Portal Scraper         │
    │ Playwright + Captcha    │
    │ Bypass (free)           │
    │                         │
    │ lookupMultiplePlates()  │
    │ 5s delay between plates │
    │ ~14s per plate          │
    └────────┬────────────────┘
             │
             ▼
  ┌──────────────────────────────┐
  │   Chicago Finance Portal     │
  │  POST /api/searches → JSON   │
  │  {receivables: [...]}        │
  └────────────┬─────────────────┘
               │
               ▼
   ┌───────────────────────────────────┐
   │  Ticket Data Extraction           │
   │  parseTicketsFromApiResponse()    │
   │                                   │
   │  Returns: PortalTicket[]          │
   │  - ticket_number                  │
   │  - violation_type (auto-detect)   │
   │  - issue_date, amount, etc.       │
   └────────────┬──────────────────────┘
                │
                ▼
   ┌──────────────────────────────────────┐
   │  For each ticket found:              │
   │                                      │
   │  1. Check duplicates                 │
   │  2. Skip if resolved                 │
   │  3. Parse violation date             │
   │  4. Map violation type               │
   └────────────┬─────────────────────────┘
                │
                ├──────────┬──────────┬──────────┐
                │          │          │          │
                ▼          ▼          ▼          ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
         │ Create   │ │Generate  │ │Generate  │ │Send      │
         │Ticket    │ │Defense   │ │Evidence  │ │Evidence  │
         │Record    │ │Letter    │ │Request   │ │Email     │
         │          │ │Template  │ │HTML      │ │(Resend)  │
         │detected_ │ │          │ │          │ │          │
         │tickets   │ │contest_  │ │via Resend│ │to user   │
         │table     │ │letters   │ │API       │ │          │
         │          │ │table     │ │          │ │          │
         └────────┬─┘ └────────┬─┘ └────────┬─┘ └────────┬─┘
                  │            │            │            │
                  └────────────┼────────────┼────────────┘
                               │            │
                               ▼            ▼
                        ┌──────────────────────────┐
                        │  Audit Log + Admin Email │
                        │  ticket_audit_log table  │
                        │  Email to admin          │
                        └──────────────────────────┘
                               │
                               ▼
                  ┌─────────────────────────────┐
                  │   WAITING FOR USER RESPONSE │
                  │   (Day 17 evidence window)  │
                  │                             │
                  │  User receives email with:  │
                  │  - Evidence questions       │
                  │  - Quick tips               │
                  │  - Pitfalls to avoid        │
                  │  - Win rate (%)             │
                  │  - Deadline                 │
                  │                             │
                  │  User replies to:           │
                  │  evidence+{id}@...com       │
                  └────────────┬────────────────┘
                               │
                               ▼
              ┌────────────────────────────────┐
              │  [GAP] Email parsing missing!  │
              │  System doesn't capture reply  │
              │  Should feed to detected_      │
              │  tickets.user_evidence         │
              └────────────┬────────────────────┘
                           │
                           ▼
        ┌──────────────────────────────────────┐
        │  After Evidence Deadline (Day 17):   │
        │                                      │
        │  1. Mark letter status               │
        │  2. [GAP] Regenerate letter with     │
        │     evidence integrated              │
        │  3. Update contest_letters           │
        │  4. Move to 'ready_to_mail'          │
        └────────────┬──────────────────────────┘
                     │
                     ▼
         ┌───────────────────────────────┐
         │   autopilot-mail-letters.ts   │
         │   (Daily or on-demand cron)   │
         │                               │
         │  Get all 'ready_to_mail'      │
         │  letters                      │
         └────────────┬──────────────────┘
                      │
                      ▼
          ┌─────────────────────────────┐
          │  Lob.com Integration        │
          │                             │
          │  POST /v1/letters with:     │
          │  - From: User address       │
          │  - To: City of Chicago      │
          │  - Letter HTML content      │
          │                             │
          │  Returns:                   │
          │  - lob_id (tracking)        │
          │  - expected_delivery_date   │
          └────────────┬────────────────┘
                       │
                       ▼
          ┌──────────────────────────┐
          │  Physical Mail Sent       │
          │  Chicago Department      │
          │  of Finance              │
          │                          │
          │  Update status='mailed'  │
          │  Record lob_id           │
          │  Record mailed_at        │
          └──────────────┬───────────┘
                         │
                         ▼
             ┌───────────────────────┐
             │ [GAP] Outcome         │
             │ Tracking Missing!     │
             │                       │
             │ No mechanism to:      │
             │ - Record hearing date │
             │ - Track verdict       │
             │ - Update ticket       │
             │ - Feedback to ML      │
             └───────────────────────┘
```

---

## 10. CONFIGURATION CHECKLIST

### Required Environment Variables
- [ ] `NEXT_PUBLIC_SUPABASE_URL` - Supabase project
- [ ] `SUPABASE_SERVICE_ROLE_KEY` - Admin auth
- [ ] `RESEND_API_KEY` - Email service

### Optional Environment Variables
- [ ] `CAPSOLVER_API_KEY` - Captcha fallback (~$0.002/solve if city blocks bypass)
- [ ] `LOB_API_KEY` - Physical mail service (needed for `autopilot-mail-letters.ts`)
- [ ] `PORTAL_CHECK_MAX_PLATES` - Max plates per run (default: 50)
- [ ] `PORTAL_CHECK_DELAY_MS` - Delay between lookups (default: 5000)
- [ ] `LOB_TEST_MODE` - Send letters to user instead of city (for testing)

### Database Tables Required
- `monitored_plates` - User plates to check
- `detected_tickets` - Tickets found
- `contest_letters` - Generated defense letters
- `autopilot_subscriptions` - Subscription status
- `autopilot_admin_settings` - System settings (kill switches, triggers)
- `ticket_audit_log` - Action log
- `user_profiles` - User mailing addresses
- `auth.users` - Supabase auth

### Email Addresses
- **Evidence replies**: `evidence+{ticket_id}@autopilotamerica.com` (no handler found)
- **Admin notifications**: `randyvollrath@gmail.com` (hardcoded)
- **Send from**: `alerts@autopilotamerica.com` (via Resend)

---

## 11. RECOMMENDATIONS FOR COMPLETING THE SYSTEM

### Priority 1: Critical Missing Pieces
1. **Email parsing pipeline** - Listen for `evidence+{ticket_id}@autopilotamerica.com` replies
   - Parse structured responses to evidence questions
   - Extract attached PDFs/images
   - Store in `detected_tickets.user_evidence` JSONB
   - Trigger letter regeneration

2. **Letter regeneration** - Update `contest_letters.letter_content` after evidence arrives
   - Incorporate user evidence references ("As shown in attached Exhibit A...")
   - Mention specific documents submitted
   - Update defense template logic

3. **User-facing dashboard** - Show tickets, evidence requests, status
   - Tickets tab: detected tickets, evidence deadline, submit evidence
   - Letters tab: generated letters (preview, approve/modify before mailing)
   - Results tab: hearing outcomes, appeals

### Priority 2: Robustness
4. **Outcome recording** - Endpoint to record hearing results
   - Hearing date, officer name, disposition (dismissed/upheld)
   - Appeal tracking
   - Feedback loop to improve letter generation

5. **Error handling & retries** - Email failures, Lob failures
   - Queue system for failed mail jobs
   - Retry logic with exponential backoff
   - Delivery verification

6. **Weather data integration** - Auto-lookup weather for ticket date/location
   - OpenWeather or similar API
   - Store in ticket record
   - Reference in letter if applicable (snow route, street cleaning)

### Priority 3: Intelligence & Optimization
7. **GPS evidence integration** - Capture mobile app GPS data
   - Endpoint to submit GPS departure records
   - Store in `detected_tickets.user_evidence`
   - Auto-generate as evidence for street cleaning tickets

8. **Ward/Officer intelligence** - Implement scoring from schema
   - Populate `ward_contest_intelligence` with FOIA data
   - Populate `hearing_officer_patterns` from outcomes
   - Adjust letter strategy per ward/officer

9. **Signage crowdsourcing** - Collect condition reports
   - Endpoint for users to report missing/damaged signs
   - Location-based storage and verification
   - Reference in case research

---

## 12. TESTING CHECKLIST

### Unit Tests Needed
- [ ] Portal scraper form filling (mocking Playwright)
- [ ] API response parsing (success, 422 no tickets, errors)
- [ ] Ticket duplicate detection
- [ ] Violation type mapping (all 20+ types)
- [ ] Letter template substitution
- [ ] Evidence guidance retrieval

### Integration Tests
- [ ] Full portal check run (with test Supabase)
- [ ] Ticket creation → letter generation → email send
- [ ] Kill switch functionality
- [ ] Manual trigger via `portal_check_trigger`
- [ ] Lob.com letter mailing

### End-to-End Tests
- [ ] User receives evidence request email
- [ ] User submits evidence (manual reply to email)
- [ ] Evidence appears in dashboard
- [ ] Letter updated with evidence
- [ ] Letter sent via mail
- [ ] Admin receives notifications

### Portal Compatibility Tests
- [ ] Portal changes (UI, form structure)
- [ ] Captcha bypass still works
- [ ] API response structure changes
- [ ] Rate limiting (5s delay sufficient?)

---

## CONCLUSION

The ticket contesting system is **architecturally sound** with a clean data pipeline from discovery → evidence collection → letter mailing. However, it's **functionally incomplete** on the evidence collection side:

**Current state**: System finds tickets → generates generic letters → mails them
**Intended state**: System finds tickets → collects user evidence → generates informed letters → mails them

The evidence request email exists and looks great, but the system has **no way to receive or process user replies**. This is the critical gap preventing the system from being production-ready.

**Estimated effort to complete**: 20-30 hours of development to add email parsing, letter regeneration, user dashboard, and outcome tracking.

