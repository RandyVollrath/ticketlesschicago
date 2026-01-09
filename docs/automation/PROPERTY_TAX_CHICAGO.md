# Chicago Property Tax Automated Contesting

## Purpose
Build an end-to-end automated system that helps Chicago (Cook County) property owners
contest their property tax assessment with minimal user effort.

The system should:
- Detect over-assessment
- Prepare legally valid appeal evidence
- File appeals within statutory deadlines
- Track outcomes and notify users

Automation and reliability are higher priority than feature breadth.

---

## Scope

IN SCOPE:
- Cook County residential properties
- Assessed value appeals
- Public data and FOIA-backed inputs
- Email + dashboard interaction

OUT OF SCOPE:
- Commercial properties
- Exemptions (for now)
- In-person hearings
- County expansion beyond Cook

---

## User Model

- Busy homeowner
- Low tolerance for paperwork
- Wants reassurance, not education
- Will not gather documents unless clearly prompted

Design assumption:
If the user has to think, the system failed.

---

## High-Level Workflow

1. Identify property (PIN or address)
2. Fetch assessment data
3. Analyze comps
4. Determine appeal viability
5. Generate appeal evidence
6. Prepare or file appeal
7. Track outcome
8. Notify user

Each step must be:
- Loggable
- Restartable
- Testable

---

## Data Sources

Priority order:
1. Cook County Assessor public data
2. Board of Review data
3. FOIA historical datasets
4. Existing internal datasets

Avoid scraping unless explicitly approved.

---

## Legal Constraints

- Respect Cook County deadlines
- Match official appeal formats
- No guaranteed outcome language
- Clear non-legal-advice disclaimer

If unsure, stop and ask.

---

## Automation Rules

- Prefer deterministic logic over inference
- Use LLMs only for:
  - Narrative explanation
  - Evidence summaries
  - User-facing text

Never fabricate:
- Deadlines
- Legal arguments
- Property values

---

## Verification (Required)

Every meaningful change must be verifiable via:
- Dry-run with mock property data
- Generated appeal packet
- Unit test of assessment logic
- Human-reviewable output

If verification is missing, the task is incomplete.

---

## Known Pitfalls

- Do not hardcode deadlines
- Do not confuse assessed vs market value
- Do not overfit comps
- Do not assume exemptions

Add new mistakes here as they occur.

---

## When Idle

If no explicit instruction is given:
- Improve verification
- Simplify steps
- Identify automation gaps
- Propose next concrete milestone

---

## Implementation Status (as of 2026-01-05)

### Completed
- Cook County Socrata API integration (`lib/cook-county-api.ts`)
- Property lookup by PIN or address
- Comparable property analysis
- Opportunity scoring (0-100 scale with confidence levels)
- Appeal letter generation via Claude
- Frontend wizard at `/property-tax`
- Database schema for appeals, comparables, deadlines
- Deadline safety: DEADLINE_UNKNOWN state blocks filing until confirmed

### Verification
- Dry-run test: `npx tsx scripts/test-property-tax-flow.ts`
- Unit tests: `npx tsx scripts/test-opportunity-scoring.ts`

### Key Design Decisions
1. **No hardcoded deadlines**: Township deadlines stored in DB with status (unknown/confirmed/expired). Filing blocked if status is unknown.
2. **Value fallback chain**: Uses board_tot → certified_tot → mailed_tot since current year may not have BOR decisions.
3. **Pure scoring function**: `calculateOpportunityScore()` extracted for testability.

### API Endpoints
- `GET /api/property-tax/lookup` - Property lookup
- `POST /api/property-tax/analyze` - Opportunity analysis
- `POST /api/property-tax/start-appeal` - Create appeal (checks deadline status)
- `POST /api/property-tax/generate-letter` - Generate appeal letter
- `GET /api/property-tax/appeals` - List user's appeals

### Pending
- Admin UI for populating deadline dates
- Appeal outcome tracking
- Notification cron for deadline reminders
- PDF export of appeal packet

---

## Production Assist Mode (as of 2026-01-05)

### Product Definition

**User Promise:**
For $179, we analyze your Cook County property assessment using official public data, compare it to similar properties in your township, and prepare a professional appeal letter with all required evidence. You receive a complete appeal packet ready to mail to the Board of Review. We handle the analysis and paperwork; you handle the mailing.

### Pricing
- Flat fee: $179
- Payment via Stripe Checkout
- Payment required after free analysis
- Letter generation locked until payment confirmed

### User Flow (5 stages)

1. **Lookup** - User enters address or PIN
2. **Analysis** - Free preview shows opportunity score, estimated overvaluation, potential tax savings
3. **Paywall** - $179 payment with consent checkboxes:
   - Authorization to analyze property data
   - Acknowledgment this is not legal advice
4. **Stripe Checkout** - Redirect to Stripe hosted page
5. **Complete** - Success state with:
   - Payment confirmed banner
   - Appeal letter preview (copyable)
   - Filing deadline warning
   - BOR mailing address
   - Next steps instructions

### Payment Integration

**Stripe Checkout Flow:**
- `POST /api/property-tax/checkout` creates Stripe Checkout session
- User redirected to Stripe hosted checkout
- On success, redirects to `/property-tax?success=true&session_id={id}`
- Webhook at `/api/stripe-webhook` handles `checkout.session.completed`
- Appeal status updated to `paid` with `stripe_payment_intent_id`

**Required Environment Variables:**
```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PROPERTY_TAX_APPEAL_PRICE_ID=price_...  # Optional, falls back to $179 ad-hoc price
```

**Testing Payment Flow:**
1. Use Stripe test mode keys
2. Go to `/property-tax`, complete analysis
3. Click "Pay $179 & Get Package"
4. Use test card `4242 4242 4242 4242`
5. Should redirect back with letter generated

### Refund-Safe Guardrails

1. **Payment required**: `generate-letter` API returns 402 if `status !== 'paid'`
2. **Single generation**: If letter already exists, returns cached letter (no re-generation)
3. **Audit trail**: Payment intent ID stored with appeal record
4. **Unique constraint**: Index on `stripe_payment_intent_id` prevents duplicate payments

### Legal/Compliance
- Disclaimer on every page: "This is not legal advice"
- Two explicit consent checkboxes before payment
- No guaranteed outcomes language
- User responsible for filing

### Database Schema Additions
```sql
ALTER TABLE property_tax_appeals ADD COLUMN status TEXT DEFAULT 'pending';
ALTER TABLE property_tax_appeals ADD COLUMN stripe_payment_intent_id TEXT;
ALTER TABLE property_tax_appeals ADD COLUMN stripe_session_id TEXT;
ALTER TABLE property_tax_appeals ADD COLUMN paid_at TIMESTAMPTZ;
ALTER TABLE property_tax_appeals ADD COLUMN letter_generated_at TIMESTAMPTZ;
```

### What's Live Now
- Complete Stripe Checkout integration
- Free assessment analysis (lookup + scoring)
- Paid appeal letter generation
- Payment confirmation email
- Refund-safe letter locking
- Consent and disclaimer framework
- User-facing flow at `/property-tax`

### Explicitly Deferred
- PDF export of appeal packet
- In-app email delivery of documents
- Appeal outcome tracking
- Deadline reminder notifications
- Admin dashboard for deadline management

---

## Go-Live Checklist (Production)

### 1. Stripe Dashboard Setup

**Create Product + Price:**
1. Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products)
2. Click "Add product"
3. Name: `Property Tax Appeal Package`
4. Description: `Professional appeal letter for Cook County property tax assessment`
5. Pricing: One-time, $179.00
6. Copy the Price ID (starts with `price_`)

**Create Webhook Endpoint:**
1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. URL: `https://www.ticketlessamerica.com/api/stripe-webhook`
4. Events to listen for:
   - `checkout.session.completed`
   - `payment_intent.succeeded`
5. Copy the Signing secret (starts with `whsec_`)

### 2. Environment Variables (Vercel)

Set these in Vercel Dashboard → Project → Settings → Environment Variables:

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PROPERTY_TAX_APPEAL_PRICE_ID=price_...  # Optional, falls back to $179 ad-hoc
```

Note: If `STRIPE_PROPERTY_TAX_APPEAL_PRICE_ID` is not set, the system creates an ad-hoc $179 price per checkout.

### 3. Test the Payment Flow

**In Test Mode (before going live):**
1. Ensure test mode keys are set in Vercel (sk_test_...)
2. Go to `/property-tax`
3. Enter address: `123 E Main St, Barrington`
4. Complete analysis
5. Click "Pay $179 & Get Package"
6. Use test card: `4242 4242 4242 4242`, any future date, any CVC
7. Complete checkout
8. Verify:
   - Redirected back to `/property-tax?success=true`
   - Letter is generated
   - Confirmation email received

**Verify Webhook:**
1. Go to Stripe Dashboard → Webhooks → [your endpoint]
2. Check "Attempted events" - should show successful delivery
3. Check appeal record in Supabase: `status = 'paid'`

### 4. Switch to Production

1. In Vercel, update environment variables to live keys
2. Create new webhook endpoint with live keys
3. Deploy
4. Test with a real $179 payment (refund after)

### 5. Post-Launch Monitoring

**Check daily:**
- Stripe Dashboard → Payments for successful charges
- Supabase → `property_tax_appeals` for status progression
- PostHog → Property Tax funnel events

**Alert triggers (automatic):**
- DB update failure sends email to `randyvollrath@gmail.com`
- Failed letter generation marks appeal as `letter_failed`

---

## Analytics Events

| Event | When | Properties |
|-------|------|------------|
| `property_tax_page_viewed` | Page load | - |
| `property_tax_analysis_complete` | Analysis shown | score, savings, township, confidence |
| `property_tax_checkout_started` | Pay button clicked | score, savings, township |
| `property_tax_checkout_completed` | Return from Stripe success | score, savings, township |
| `property_tax_letter_generated` | Letter created | township, score |
| `property_tax_letter_copied` | Copy button clicked | - |

---

## Security Checklist

- [x] No secrets logged in console
- [x] Webhook signature verification enforced
- [x] Idempotency check prevents double processing
- [x] Payment required before letter generation (402 response)
- [x] Single letter generation per payment (cached return)
- [x] Unique constraint on `stripe_payment_intent_id`
- [x] Audit trail via `logAuditEvent()`
