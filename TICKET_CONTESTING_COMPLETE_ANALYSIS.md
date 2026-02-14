# TICKET CONTESTING SYSTEM - COMPREHENSIVE ANALYSIS

## Executive Summary

The Ticketless Chicago platform has a sophisticated, multi-layered ticket contesting system designed specifically for Chicago parking and traffic violations. The system handles:

1. **Letter Generation** - AI-powered and template-based contest letters
2. **Evidence Collection** - Email forwarding system for receipts and documentation
3. **Violation Classification** - 15+ violation types with specialized defense templates
4. **Contest Kits** - Win-rate-optimized argument templates based on FOIA court data
5. **Mailing Service** - Integration with Lob.com for physical letter delivery
6. **City Sticker Violations** - Specialized handling with 70% historical win rate

---

## 1. LETTER GENERATION ARCHITECTURE

### 1.1 Core Generation Pipeline

**Files:**
- `/pages/api/contest/generate-letter.ts` - Main letter generation endpoint
- `/pages/api/cron/autopilot-mail-letters.ts` - Mailing execution
- `/pages/api/cron/autopilot-generate-letters.ts` - Batch letter generation

**Flow:**
```
User submits contest → AI generates letter draft → 
Contest kit evaluation → Weather defense check → 
GPS parking evidence lookup → Letter saved to DB → 
User reviews → Approval workflow → Mailed via Lob
```

### 1.2 AI Letter Generation (Claude)

**Location:** `/pages/api/contest/generate-letter.ts` (lines 505-616)

**Key Features:**
- Uses Claude 3.5 Sonnet model (claude-3-5-sonnet-20241022)
- Accepts violation code, contest grounds, and additional context
- Integrates 3 types of evidence:
  1. Historical court data (from FOIA analysis)
  2. Weather defense data
  3. GPS parking evidence from mobile app
- Outputs professional, formal letter without citing internal statistics

**Prompt Strategy:**
- Provides violation-specific contest kit templates
- Includes real successful case examples (filtered by user's evidence)
- Generates evidence checklists automatically
- Embeds win rate guidance (but instructs Claude NOT to cite percentages in letter)

### 1.3 Template-Based Generation (Fallback)

**Location:** `/pages/api/cron/autopilot-generate-letters.ts` (lines 164-317)

**Defense Templates:**
- `expired_plates`: Registration renewal proof
- `no_city_sticker`: Sticker purchase receipt
- `expired_meter`: ParkChicago app payment proof
- `disabled_zone`: Disability placard documentation
- `street_cleaning`: Weather + signage defense
- `fire_hydrant`: Distance/visibility dispute
- `residential_permit`: Permit/visitor pass proof
- `parking_prohibited`: Signage clarity issues
- `no_standing_time_restricted`: Timing disputes
- `missing_plate`: Plate visibility proof
- `commercial_loading`: Loading activity documentation
- `red_light`: Yellow light timing + camera accuracy
- `speed_camera`: Camera calibration + signage issues
- `other_unknown`: Generic fallback template

**Template System:**
```typescript
interface DefenseTemplate {
  type: string;           // e.g., 'registration_renewed'
  template: string;       // With {placeholders} for auto-fill
}

// Variables replaced automatically:
// {ticket_number}, {violation_date}, {violation_description}
// {amount}, {location}, {plate}, {state}
// {weather_defense} (if applicable)
```

---

## 2. CITY STICKER VIOLATION HANDLING

### 2.1 Contest Kit: City Sticker (9-100-010)

**Location:** `/lib/contest-kits/city-sticker.ts`

**Statistics:**
- Violation Code: `9-100-010`
- Fine Amount: $120
- Historical Win Rate: **70%** (highest of common violations!)
- Category: `sticker`

### 2.2 Primary & Secondary Arguments

**Primary Argument: "Valid Sticker Was Displayed" (75% win rate)**
```
I respectfully contest this citation on the grounds that a valid City of Chicago 
vehicle sticker was properly displayed on my vehicle at the time this citation was issued.

My vehicle (License Plate: [LICENSE_PLATE]) had a current, valid city sticker affixed 
to the lower-left corner of the windshield as required by Chicago Municipal Code. 
The sticker was [STICKER_STATUS].

[EVIDENCE_REFERENCE]

I believe the citing officer may have:
- Been unable to see the sticker due to glare, weather, or viewing angle
- Recorded incorrect license plate information
- Mistaken my vehicle for another

I have attached photographic evidence showing the valid sticker displayed on my vehicle. 
I respectfully request that this citation be dismissed.
```

**Secondary Argument: "Non-Chicago Resident" (80% win rate)**
```
I respectfully contest this citation on the grounds that I am not a resident of the 
City of Chicago and therefore not subject to the city vehicle sticker requirement.

My vehicle is registered at [REGISTRATION_ADDRESS], which is outside Chicago city limits. 
Chicago Municipal Code Section 9-100-010 only requires city stickers for vehicles 
"principally used or kept" in Chicago.

[RESIDENCY_EVIDENCE]

As a non-resident, I am exempt from the city sticker requirement. My vehicle was 
temporarily in Chicago on [DATE] for [REASON], but my permanent residence and vehicle 
registration remain outside the city.

I respectfully request that this citation be dismissed based on my non-resident status.
```

### 2.3 Situational Arguments

1. **Recently Purchased Vehicle** (85% win rate)
   - New owners have 30-day grace period
   - Requires: Purchase date, bill of sale

2. **Sticker Was Stolen** (70% win rate with police report)
   - Must file CPD report
   - Get Records Division (RD) number

3. **Temporary Stay in Chicago** (75% win rate)
   - Visitor status exemption
   - Requires: Proof of permanent address elsewhere

### 2.4 City Sticker Evidence Requirements

**Recommended Evidence (in order of impact):**

| Evidence Type | Impact Score | Notes |
|---------------|--------------|-------|
| Sticker Photo | 0.35 | Clear windshield photo showing sticker + expiration |
| Purchase Receipt | 0.30 | Online confirmation, City Clerk receipt, or credit card statement |
| Registration Docs | 0.20 | IL Secretary of State registration showing address |
| Police Report | 0.40 | For stolen sticker claims (RD number required) |
| Residency Proof | 0.35 | Lease, utility bill, mail (for non-resident defense) |
| Bill of Sale | 0.25 | For recent purchase defense (within 30 days) |

**Tips:**
- Sticker must be in lower-left windshield corner
- Make expiration date visible in photos
- Take photos from outside the vehicle
- Non-residents are EXEMPT - keep proof handy
- File police report immediately if sticker stolen

### 2.5 City Sticker Tracking Fields

System tracks for outcome analysis:
- `defense_type`: Selected defense strategy
- `had_valid_sticker`: Boolean confirmation
- `evidence_provided`: Types of evidence submitted
- `outcome`: Dismissed, Reduced, Denied, Pending
- `hearing_date`: Optional hearing scheduled

---

## 3. EVIDENCE COLLECTION FLOW

### 3.1 Email Forwarding Setup

**Files:**
- `/components/EmailForwardingSetup.tsx` - User instructions
- `/pages/api/email/forward.ts` - Receipt processing webhook

**Supported Providers:**
- ComEd (electricity)
- Peoples Gas
- Xfinity/Comcast (internet)
- Generic utilities

**Process:**
1. User sets up Gmail filter to forward bills to unique email
2. Email arrives at Resend/SendGrid webhook
3. Claude AI extracts structured data from email
4. Data stored in `city_sticker_receipts` table

### 3.2 City Sticker Receipt Database

**Location:** `/supabase/migrations/20260207113000_create_city_sticker_receipts.sql`

```sql
CREATE TABLE city_sticker_receipts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  sender_email TEXT NOT NULL,
  email_subject TEXT,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  forwarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
);

-- RLS enabled: Users can only view/insert own receipts
```

### 3.3 Evidence Guidance System

**Location:** `/lib/contest-kits/evidence-guidance.ts`

**Purpose:** Customize evidence request emails based on violation type

**For City Sticker (lines 85-127):**

```typescript
{
  emailSubject: 'City Sticker Ticket - 70% Win Rate - Purchase Receipt Needed!',
  title: 'Your City Sticker Ticket Has Excellent Odds!',
  winRate: 0.70,
  intro: 'City sticker tickets have a 70% success rate! The most common winning 
          defense is proving you purchased the sticker before the ticket, or that 
          you\'re not required to have one (non-Chicago resident, new vehicle, etc.).',
  
  questions: [
    {
      text: 'Did you purchase your city sticker BEFORE the ticket date? 
             Please send a screenshot of your purchase confirmation email, 
             online receipt, or credit card statement showing the purchase.',
      whyItMatters: 'Proof of prior purchase is the strongest defense - 
                     showing you bought it before the ticket typically results 
                     in dismissal.',
      impactScore: 0.45,
      goodExample: 'Email showing "City of Chicago Vehicle Sticker Purchase - 
                    Confirmation #12345 - December 15, 2024"'
    },
    {
      text: 'Are you registered outside Chicago city limits? 
             Is this your first time being ticketed in Chicago?',
      whyItMatters: 'Non-residents and visitors are exempt from the city 
                     sticker requirement. If you don\'t live in Chicago, 
                     this ticket should be dismissed.',
      impactScore: 0.40,
      goodExample: '"I live in Evanston and was just visiting downtown 
                    Chicago for the day. My vehicle is registered to my 
                    Evanston address."'
    },
    // ... more questions ...
  ],
  
  quickTips: [
    'Check email for "Chicago Vehicle Sticker" - the purchase confirmation is gold',
    'Credit card statement showing City of Chicago payment works too',
    'If you live outside Chicago, that alone should get the ticket dismissed',
    'New car? The bill of sale date proves your grace period'
  ]
}
```

---

## 4. CONTEST KIT SYSTEM

### 4.1 Kit Architecture

**Location:** `/lib/contest-kits/`

**Files:**
- `types.ts` - Type definitions for contest kits
- `index.ts` - Kit registry and lookup functions
- `city-sticker.ts` - City sticker specific kit
- `[15+ other violation types]`
- `evidence-guidance.ts` - Evidence request templates
- `policy-engine.ts` - Contest evaluation engine

### 4.2 Contest Kit Structure

```typescript
interface ContestKit {
  violationCode: string;           // e.g., '9-100-010'
  name: string;                    // 'City Sticker Violation'
  description: string;
  category: 'parking' | 'moving' | 'equipment' | 'sticker' | 'camera';
  fineAmount: number;              // $120
  baseWinRate: number;             // 0.70 (70%)

  eligibility: {
    rules: EligibilityRule[];      // Contest deadline, required defenses
    weatherRelevance: 'primary' | 'supporting' | 'emergency' | false;
    maxContestDays: number;        // Usually 21 days for Chicago
  };

  evidence: {
    required: EvidenceItem[];      // Critical for case
    recommended: EvidenceItem[];   // Significantly improves odds
    optional: EvidenceItem[];      // Nice to have
  };

  arguments: {
    primary: ArgumentTemplate;     // Best argument (75% win rate)
    secondary: ArgumentTemplate;   // Backup argument (80% win rate)
    fallback: ArgumentTemplate;    // Generic fallback (50% win rate)
    situational?: ArgumentTemplate[];  // Special circumstances
  };

  tracking: {
    fields: OutcomeTrackingField[];  // Fields to track for analysis
  };

  tips: string[];                  // Specific advice
  pitfalls: string[];              // Common mistakes
}
```

### 4.3 Violation Code Registry

**Location:** `/lib/contest-kits/index.ts` (lines 70-90)

All 15+ violation types mapped to codes:

```typescript
export const CONTEST_KITS: Record<string, ContestKit> = {
  // Parking violations
  '9-64-010': streetCleaningKit,
  '9-100-010': cityStickerKit,          // CITY STICKER
  '9-64-070': residentialPermitKit,
  '9-64-100': snowRouteKit,
  '9-64-170': expiredMeterKit,
  
  // Equipment violations
  '9-76-160': expiredPlatesKit,
  '9-80-190': expiredPlatesKit,         // Alias for expired registration
  '9-80-040': missingPlateKit,
  
  // Zone violations
  '9-64-130': fireHydrantKit,
  '9-64-050': busStopKit,
  '9-64-090': bikeLaneKit,
  '9-64-180': handicappedZoneKit,
  '9-64-020': parkingAlleyKit,
  '9-64-140': noStandingKit,
  '9-64-110': doubleParkingKit,
  '9-64-160': commercialLoadingKit,
};
```

**Win Rates by Violation (from FOIA data 2023-2024):**

| Violation | Win Rate | Category |
|-----------|----------|----------|
| Expired Plates | 75% | Equipment |
| City Sticker | 70% | Sticker |
| Handicapped Zone | 68% | Zone |
| Expired Meter | 67% | Parking |
| Commercial Loading | 59% | Zone |
| No Standing/Time Restricted | 58% | Zone |
| Residential Permit | 54% | Zone |
| Missing Plate | 54% | Equipment |
| Fire Hydrant | 44% | Zone |
| Street Cleaning | 34% | Parking |
| Snow Route | 30% | Parking |
| Double Parking | 25% | Zone |
| Parking in Alley | 25% | Zone |
| Bus Stop | 20% | Zone |
| Bike Lane | 18% | Zone |

---

## 5. LETTER MAILING SYSTEM

### 5.1 Mailing Workflow

**Location:** `/pages/api/cron/autopilot-mail-letters.ts`

**Process:**
1. Cron job runs (scheduled or triggered)
2. Checks kill switches (pause_all_mail, pause_ticket_processing)
3. Fetches letters where evidence deadline passed
4. For each letter:
   - Gets user profile (mailing address)
   - Extracts evidence image URLs
   - Formats letter as HTML
   - Sends via Lob.com
   - Updates letter status to 'sent'
   - Updates ticket status to 'mailed'
   - Logs to audit trail
   - Sends user notification email
   - Queues FOIA request for evidence packet
   - Increments user's letter count

### 5.2 Lob Integration

**Service:** `/lib/lob-service.ts`

**Key Functions:**
- `sendLetter()` - Send physical letter via Lob
- `formatLetterAsHTML()` - Convert text to HTML with evidence images
- Recipient: CHICAGO_PARKING_CONTEST_ADDRESS
  - City of Chicago
  - Department of Administrative Hearings
  - 400 W. Superior Street
  - Chicago, IL 60654

**Test Mode:**
- Environment variable: `LOB_TEST_MODE=true`
- Sends letters to user's address instead of city hall
- Useful for testing without actual mailing

### 5.3 Evidence Image Handling

**Location:** `/pages/api/cron/autopilot-mail-letters.ts` (lines 546-573)

**Process:**
- Extracts `user_evidence` JSON from ticket record
- Filters for image URLs only:
  - `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`
  - Vercel Blob URLs with `image` indicator
  - **Excludes PDFs and other file types**
- Embeds images in formatted HTML
- Images included in printed letter via Lob

**Database Storage:**
- `user_evidence` stored as TEXT (not JSONB)
- Must parse JSON at runtime
- Contains array of `attachment_urls`

### 5.4 User Notifications

**Email Sent On Mailing:**
- Subject: "✉️ Contest Letter Mailed - Ticket #[NUMBER]"
- Shows expected delivery date
- Includes PDF preview link
- Explains next steps (city review, hearing notification)
- Provides tracking information

---

## 6. APPROVAL WORKFLOW

### 6.1 Approval Request Email

**Location:** `/pages/api/cron/autopilot-generate-letters.ts` (lines 24-133)

**Trigger:** When user has "Require Approval" setting enabled

**Email Contents:**
- Ticket details (number, violation, date, amount, plate)
- Letter preview (first 800 chars)
- "Approve & Mail" button
- "Skip This Ticket" button
- View full letter link

**JWT Token:** 7-day expiry for security

### 6.2 Approval Endpoint

**Location:** `/pages/api/autopilot/approve-letter.ts`

**Parameters:**
- `token`: JWT signed token
- `action`: "approve" or "skip"

**Actions:**
- **Approve**: Updates letter status to "approved", triggers mailing
- **Skip**: Updates letter status to "skipped", stops processing

---

## 7. VIOLATION TYPE CATEGORIZATION

### 7.1 Category System

**Location:** `/lib/contest-kits/types.ts` (line 86)

```typescript
category: 'parking' | 'moving' | 'equipment' | 'sticker' | 'camera';
```

**By Type:**

| Category | Violation Types |
|----------|-----------------|
| **sticker** | City Sticker (9-100-010) |
| **equipment** | Expired Plates, Missing Plate, License Plate |
| **parking** | Street Cleaning, Snow Route, Expired Meter, Parking in Alley |
| **zone** | Fire Hydrant, Bus Stop, Bike Lane, Handicapped Zone, Residential Permit, No Standing, Double Parking, Commercial Loading |
| **camera** | Red Light, Speed Camera |

### 7.2 Weather Relevance

Different violations have different weather defense applicability:

**PRIMARY (weather invalidates ticket):**
- Street Cleaning (9-64-010) - Cancelled in bad weather
- Snow Route (9-64-100) - Threshold must be met

**SUPPORTING (weather contributes to circumstance):**
- Expired Meter (9-64-170)
- Residential Permit (9-64-070)
- Fire Hydrant (9-64-130)
- Bus Stop (9-64-050)
- Bike Lane (9-64-090)

**EMERGENCY (weather created unsafe conditions):**
- Parking in Alley (9-64-020)
- Handicapped Zone (9-64-180)

**NOT RELEVANT:**
- City Sticker, Expired Plates, Missing Plate, Double Parking, Commercial Loading

---

## 8. DATABASE SCHEMA

### 8.1 Key Tables

**detected_tickets**
```
- id: UUID
- user_id: UUID (FK auth.users)
- plate: TEXT
- state: TEXT
- ticket_number: TEXT
- violation_type: TEXT          // e.g., 'no_city_sticker'
- violation_code: TEXT          // e.g., '9-100-010'
- violation_description: TEXT
- violation_date: TIMESTAMPTZ
- amount: NUMERIC
- location: TEXT
- status: TEXT                  // 'found', 'letter_generated', 'mailed', etc.
- user_evidence: TEXT           // JSON array of attachment URLs
- is_test: BOOLEAN
- found_at: TIMESTAMPTZ
- evidence_deadline: TIMESTAMPTZ
```

**contest_letters**
```
- id: UUID
- ticket_id: UUID (FK detected_tickets)
- user_id: UUID (FK auth.users)
- letter_content: TEXT
- letter_text: TEXT             // Original text before AI
- defense_type: TEXT
- status: TEXT                  // 'draft', 'pending_review', 'pending_approval', 'approved', 'sent', 'failed'
- lob_letter_id: TEXT           // Lob.com ID
- letter_pdf_url: TEXT
- tracking_number: TEXT
- created_at: TIMESTAMPTZ
- sent_at: TIMESTAMPTZ
- mailed_at: TIMESTAMPTZ
```

**city_sticker_receipts**
```
- id: UUID
- user_id: UUID (FK auth.users)
- sender_email: TEXT
- email_subject: TEXT
- storage_path: TEXT
- file_name: TEXT
- forwarded_at: TIMESTAMPTZ
- created_at: TIMESTAMPTZ
```

**ticket_audit_log**
```
- ticket_id: UUID
- user_id: UUID
- action: TEXT                  // 'letter_generated', 'letter_mailed', etc.
- details: JSONB
- performed_by: TEXT            // User ID or 'autopilot_cron'
- created_at: TIMESTAMPTZ
```

---

## 9. AUTOPILOT MAIL LETTERS CRON

### 9.1 Execution Details

**Location:** `/pages/api/cron/autopilot-mail-letters.ts`

**Trigger:**
- Scheduled Vercel cron job OR
- Manual trigger with CRON_SECRET

**Processing:**
- Limit: 20 letters per execution
- Rate limit: 1 second between API calls
- Max duration: 2 minutes
- Batch processing for scalability

### 9.2 FOIA Request Queueing

**Location:** `/pages/api/cron/autopilot-mail-letters.ts` (lines 362-404)

When letter is mailed, system queues FOIA request:

```typescript
{
  ticket_id: string;
  contest_letter_id: string;
  user_id: string;
  request_type: 'ticket_evidence_packet';
  status: 'queued';
  source: 'autopilot_mailing';
  request_payload: {
    ticket_number: string;
    queued_by: 'autopilot_mail_letters_cron';
  };
}
```

**Purpose:**
- Automatically request evidence packet from city
- Document paper trail
- Support legal proceedings
- Track discovery deadlines

---

## 10. CITY STICKER SPECIFIC CONSIDERATIONS

### 10.1 Unique Challenges

1. **Non-Resident Exemption**
   - City sticker only required for residents
   - "Principally used or kept" in Chicago
   - Visitors/temporary stay exempt
   - Requires proof of out-of-city registration

2. **Grace Period (30 days for new owners)**
   - New vehicle owners not required immediately
   - Must purchase within 30 days
   - Bill of sale proves purchase date

3. **Theft Defense**
   - Sticker theft is common in Chicago
   - Requires CPD police report
   - Records Division (RD) number needed
   - Must file report promptly

4. **Display Requirements**
   - Must be affixed to lower-left windshield
   - Expiration date must be visible
   - Glare/weather may obscure from officer view
   - Photos are strongest evidence

### 10.2 Evidence Priority for City Sticker

**Strongest to Weakest:**

1. **Police Report** (for stolen sticker)
   - Shows sticker was reported missing
   - Predate ticket if possible
   - RD number + case info

2. **Purchase Receipt**
   - City Clerk online confirmation
   - Currency exchange receipt
   - City of Chicago payment statement
   - Proves timely purchase

3. **Sticker Photo**
   - Clear windshield photo
   - Visible expiration date
   - Taken from outside vehicle
   - Timestamp if available

4. **Registration Documents**
   - IL Secretary of State registration
   - Proves residency/non-residency
   - Bill of sale for new vehicle

5. **Residency Proof** (for non-resident defense)
   - Out-of-city lease/utility bill
   - Out-of-state registration

### 10.3 Win Rate Expectations

- **With Purchase Receipt:** ~85% dismissal
- **With Sticker Photo:** ~75% dismissal
- **Non-Resident Status:** ~80% dismissal
- **Generic Contest:** ~50% dismissal
- **Without Evidence:** ~30% dismissal

---

## 11. INTEGRATION POINTS

### 11.1 Frontend Components

**Evidence Request UI:**
- `/components/TicketContester.tsx` - Main contest interface
- `/pages/contest-ticket.tsx` - Contest page
- `/pages/tickets/[id].tsx` - Ticket detail page

**Evidence Collection:**
- `/components/EmailForwardingSetup.tsx` - Email setup instructions
- `/pages/registration-evidence.tsx` - Evidence upload
- `/pages/utility-bills.ts` - Bill forwarding endpoint

### 11.2 Mobile App Integration

**Parking Evidence:**
- Mobile app tracks GPS location + Bluetooth car connection
- Proves departure from parking location
- GPS coordinates + timestamps
- Sent to web app via API

**Data Accessible Via:**
- `/pages/api/mobile/check-parking.ts` - Mobile parking check
- Mobile app database synchronization

### 11.3 External Services

**Lob.com**
- Physical letter printing + mailing
- PDF generation
- Tracking numbers
- Delivery confirmation

**Resend Email Service**
- User notifications
- Admin notifications
- Evidence request emails
- Approval request emails

**Claude API (Anthropic)**
- Letter generation with evidence integration
- Court data analysis
- Weather defense extraction

---

## 12. QUICK REFERENCE: CITY STICKER VIOLATIONS

### The System at a Glance

**Violation Code:** 9-100-010  
**Fine Amount:** $120  
**Win Rate:** 70% (highest!)  
**Contest Deadline:** 21 days

**Fastest Winning Defenses:**
1. Purchase receipt (85% success)
2. Non-resident status (80% success)
3. Sticker photo showing display (75% success)
4. Recent vehicle purchase (85% success within 30 days)
5. Police report for stolen sticker (70% success)

**Required Evidence Types:**
- RECOMMENDED: Purchase receipt, sticker photo, registration docs
- OPTIONAL: Police report, residency proof, bill of sale

**Letter Templates Generated:**
- Primary: "Valid Sticker Was Displayed" (75% win rate)
- Secondary: "Non-Chicago Resident" (80% win rate)
- Situational: "Recently Purchased", "Sticker Stolen", "Temporary Visitor"

---

## ARCHITECTURE SUMMARY

```
User Submits Ticket
        ↓
Evidence Collection (Email forwarding, manual upload)
        ↓
Letter Generation (AI or template-based)
        ├─→ Contest Kit Evaluation
        ├─→ Weather Defense Check
        ├─→ GPS Parking Evidence Lookup
        └─→ Evidence Checklist Generation
        ↓
User Review & Approval
        ↓
Autopilot Mailing Process
        ├─→ Get Profile Info
        ├─→ Extract Evidence Images
        ├─→ Format HTML Letter
        ├─→ Send via Lob.com
        ├─→ Update Ticket Status
        ├─→ Log to Audit Trail
        ├─→ Send User Notification
        ├─→ Send Admin Notification
        └─→ Queue FOIA Request
        ↓
Tracking & Outcome
        ├─→ PDF Archive
        ├─→ Delivery Confirmation
        └─→ Outcome Recording
```

