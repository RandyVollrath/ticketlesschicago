# CITY STICKER VIOLATIONS - CODE SNIPPETS & LOCATIONS

## 1. CONTEST KIT DEFINITION

**File:** `/lib/contest-kits/city-sticker.ts`

```typescript
// Violation Code Registry Entry (from /lib/contest-kits/index.ts line 73)
'9-100-010': cityStickerKit,

// Win Rate Ranking (from /lib/contest-kits/index.ts lines 6-8)
// City Sticker: 70% success rate (second highest!)
```

---

## 2. LETTER TEMPLATE

**File:** `/pages/api/cron/autopilot-generate-letters.ts` (lines 176-184)

```typescript
no_city_sticker: {
  type: 'sticker_purchased',
  template: `I am writing to contest parking ticket #{ticket_number} issued on {violation_date} for lack of a Chicago city vehicle sticker.

At the time this ticket was issued, I had purchased my city sticker but had not yet received it in the mail / had not yet affixed it to my vehicle. I have attached proof of purchase showing the sticker was purchased prior to the citation.

Under Chicago Municipal Code Section 3-56-030, the city allows a grace period for displaying newly purchased stickers. I believe this citation was issued during that grace period.

I respectfully request that this ticket be dismissed.`,
},
```

---

## 3. EVIDENCE GUIDANCE SYSTEM

**File:** `/lib/contest-kits/evidence-guidance.ts` (lines 85-127)

```typescript
no_city_sticker: {
  violationType: 'no_city_sticker',
  emailSubject: 'City Sticker Ticket - 70% Win Rate - Purchase Receipt Needed!',
  title: 'Your City Sticker Ticket Has Excellent Odds!',
  winRate: 0.70,
  intro: `City sticker tickets have a 70% success rate! The most common winning 
          defense is proving you purchased the sticker before the ticket, or that 
          you're not required to have one (non-Chicago resident, new vehicle, etc.).`,
  questions: [
    {
      text: 'Did you purchase your city sticker BEFORE the ticket date? Please send a screenshot...',
      whyItMatters: 'Proof of prior purchase is the strongest defense...',
      impactScore: 0.45,
      goodExample: 'Email showing "City of Chicago Vehicle Sticker Purchase - Confirmation #12345..."'
    },
    // ... more questions (see full document)
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

## 4. EMAIL FORWARDING WEBHOOK

**File:** `/pages/api/email/forward.ts`

**Purpose:** Receives forwarded city sticker emails and extracts structured data

```typescript
// Accepts emails in format:
// - Resend inbound: { from, to, subject, text, html }
// - SendGrid: { text, from, subject }
// - Manual test: { email_text, from, subject }

// Uses Claude API to extract:
{
  name: string;          // Full name
  email: string;         // Email address
  vin: string;          // Vehicle VIN
  plate: string;        // License plate
  make: string;         // Vehicle make
  model: string;        // Vehicle model
  renewalDate: string;  // Calculated as 1 year after ticket date
}

// Stores in: city_sticker_receipts table
```

---

## 5. DATABASE MIGRATION

**File:** `/supabase/migrations/20260207113000_create_city_sticker_receipts.sql`

```sql
CREATE TABLE city_sticker_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_email TEXT NOT NULL,
  email_subject TEXT,
  storage_path TEXT NOT NULL,
  file_name TEXT,
  forwarded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_city_sticker_receipts_user_forwarded_at
  ON city_sticker_receipts (user_id, forwarded_at DESC);

ALTER TABLE city_sticker_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own city sticker receipts"
  ON city_sticker_receipts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own city sticker receipts"
  ON city_sticker_receipts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
```

---

## 6. MAILING SYSTEM

**File:** `/pages/api/cron/autopilot-mail-letters.ts`

**Key Function:** `sendLetterViaLob()`

```typescript
// Process:
1. Check kill switches (pause_all_mail, pause_ticket_processing)
2. Fetch letters where evidence_deadline passed
3. For each letter:
   - Get user profile (mailing address)
   - Extract evidence image URLs from user_evidence JSON
   - Filter for images only (.jpg, .jpeg, .png, .gif, .webp)
   - Format letter as HTML with embedded images
   - Send via Lob.com
   - Update letter status to 'sent'
   - Update ticket status to 'mailed'
   - Log to audit trail
   - Send user notification email
   - Queue FOIA request for evidence packet
   - Increment user letter count

// Recipient address:
City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292

// Test mode:
LOB_TEST_MODE=true  // Sends to user address instead of city
```

---

## 7. VIOLATION CODE MAPPING

**File:** `/lib/contest-kits/index.ts` (lines 95-114)

```typescript
export const VIOLATION_NAME_TO_CODE: Record<string, string> = {
  // ...
  'no_city_sticker': '9-100-010',    // CITY STICKER
  // ...
};

export const CONTEST_KITS: Record<string, ContestKit> = {
  // ...
  '9-100-010': cityStickerKit,        // CITY STICKER
  // ...
};
```

---

## 8. LETTER GENERATION ENDPOINT

**File:** `/pages/api/contest/generate-letter.ts`

**Key Features:**
- Uses Claude 3.5 Sonnet (claude-3-5-sonnet-20241022)
- Accepts: violation_code, contest_grounds, additional_context
- Integrates: Contest kit + Weather defense + GPS evidence
- Outputs: Professional formal letter (doesn't cite internal statistics)

**Request:**
```typescript
POST /api/contest/generate-letter
{
  violation_code: '9-100-010',
  ticket_id: 'uuid',
  user_id: 'uuid',
  contest_grounds: 'purchase_receipt | non_resident | sticker_displayed | etc',
  additional_context: 'any extra info'
}
```

---

## 9. APPROVAL WORKFLOW

**File:** `/pages/api/cron/autopilot-generate-letters.ts` (lines 24-133)

**Trigger:** When user has "Require Approval" setting enabled

**Email Contents:**
```typescript
// Includes:
- Ticket details (number, violation, date, amount, plate)
- Violation description
- Letter preview (first 800 chars)
- "Approve & Mail" button (JWT token, 7-day expiry)
- "Skip This Ticket" button
- View full letter link

// Token verification:
function generateApprovalToken(ticketId, userId, letterId) {
  return jwt.sign(
    { ticket_id: ticketId, user_id: userId, letter_id: letterId },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}
```

---

## 10. FRONT-END EMAIL SETUP COMPONENT

**File:** `/components/EmailForwardingSetup.tsx`

**Purpose:** Display step-by-step instructions for setting up email forwarding

**Supported Providers:**
- ComEd (Commonwealth Edison)
- Peoples Gas
- Xfinity/Comcast (Internet)
- Generic utilities

**Flow:**
1. User searches for provider emails in Gmail
2. Creates filter with "Forward it to" [forwarding_email]
3. Gmail sends verification email
4. System automatically confirms forwarding
5. Bills automatically forward

---

## 11. AUDIT LOGGING

**File:** `/pages/api/cron/autopilot-generate-letters.ts` (lines 530-544)

```typescript
// When letter generated, log to audit trail:
await supabaseAdmin
  .from('ticket_audit_log')
  .insert({
    ticket_id: ticket.id,
    user_id: ticket.user_id,
    action: 'letter_generated',
    details: {
      defense_type: template.type,  // 'sticker_purchased'
      needs_approval: needsApproval,
      reason: skipReason || 'Auto-generated',
      weather_defense_used: !!weatherDefenseParagraph,
    },
    performed_by: 'autopilot_cron',
  });
```

---

## 12. STATUS FLOW

**Ticket Status:**
```
'found'
  ↓
'letter_generated' (or 'needs_approval' if approval required)
  ↓
'approved' (after user/autopilot approval)
  ↓
'mailed' (after Lob sends physical letter)
  ↓
'failed' (if error during any step)
```

**Letter Status:**
```
'draft'
  ↓
'pending_review' (awaiting user review)
  ↓
'pending_approval' (awaiting user approval)
  ↓
'approved' (ready to mail)
  ↓
'sent' (successfully mailed)
  ↓
'failed' (if Lob error)
```

---

## 13. KILL SWITCHES

**File:** `/pages/api/cron/autopilot-generate-letters.ts` (lines 322-338)

```typescript
// Check admin settings for kill switches:
async function checkKillSwitches() {
  const { data: settings } = await supabaseAdmin
    .from('autopilot_admin_settings')
    .select('setting_key, setting_value')
    .in('setting_key', ['kill_all_mailing', 'maintenance_mode']);

  for (const setting of settings || []) {
    if (setting.setting_key === 'kill_all_mailing' && setting.setting_value?.enabled) {
      return { proceed: false, message: 'Kill switch active: letter generation disabled' };
    }
    if (setting.setting_key === 'maintenance_mode' && setting.setting_value?.enabled) {
      return { proceed: false, message: `Maintenance mode: ${setting.setting_value.message}` };
    }
  }

  return { proceed: true };
}
```

---

## 14. WIN RATE DATA

**File:** `/lib/contest-kits/index.ts` (lines 6-21)

```typescript
/*
 * Win rates from FOIA data (2023-2024):
 * - Expired Plates: 75%
 * - City Sticker: 70%           <-- SECOND HIGHEST!
 * - Handicapped Zone: 68%
 * - Expired Meter: 67%
 * - Commercial Loading: 59%
 * - No Standing/Time Restricted: 58%
 * - Residential Permit: 54%
 * - Missing Plate: 54%
 * - Fire Hydrant: 44%
 * - Street Cleaning: 34%
 * - Snow Route: 30%
 * - Double Parking: 25%
 * - Parking in Alley: 25%
 * - Bus Stop: 20%
 * - Bike Lane: 18%
 */
```

---

## QUICK LOOKUP TABLE

| Aspect | Value | Location |
|--------|-------|----------|
| Violation Code | 9-100-010 | `/lib/contest-kits/index.ts:73` |
| Win Rate | 70% | `/lib/contest-kits/city-sticker.ts` |
| Fine Amount | $120 | `/lib/contest-kits/city-sticker.ts` |
| Category | sticker | `/lib/contest-kits/city-sticker.ts` |
| Template Key | no_city_sticker | `/pages/api/cron/autopilot-generate-letters.ts:176` |
| Defense Type | sticker_purchased | `/pages/api/cron/autopilot-generate-letters.ts:177` |
| Evidence Questions | 4 main questions | `/lib/contest-kits/evidence-guidance.ts:91-114` |
| Email Subject | "City Sticker Ticket - 70% Win Rate..." | `/lib/contest-kits/evidence-guidance.ts:87` |
| Receipt Table | city_sticker_receipts | `/supabase/migrations/20260207113000...sql` |
| Primary Argument | Valid Sticker Displayed | `/lib/contest-kits/city-sticker.ts` |
| Secondary Argument | Non-Resident Status | `/lib/contest-kits/city-sticker.ts` |

