# Contest Ticket Tool - Product Design

**Goal**: Viral free tool that converts to paid letter/submission service

---

## User Flow

### Free Tool (Entry Point)

**Page**: `/contest-ticket`

```
┌─────────────────────────────────────────┐
│  🎯 Will Your Ticket Get Dismissed?     │
│                                         │
│  Upload your Chicago parking ticket    │
│  and we'll tell you your chances        │
│  based on 1.2M real cases              │
│                                         │
│  [Upload Ticket Photo]  OR  [Enter     │
│   Manually]                             │
└─────────────────────────────────────────┘
```

↓ User uploads or enters ticket info

```
┌─────────────────────────────────────────┐
│  📊 Your Ticket Analysis                │
│                                         │
│  Violation: Expired Meter (0964190A)   │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  ✅ 75.2% Dismissal Rate          │ │
│  │                                   │ │
│  │  Based on 130,308 real cases      │ │
│  │                                   │ │
│  │  Top Dismissal Reason:            │ │
│  │  "Violation is Factually          │ │
│  │   Inconsistent"                   │ │
│  │                                   │ │
│  │  Recommended Method: By Mail      │ │
│  └───────────────────────────────────┘ │
│                                         │
│  💡 You have a STRONG chance of        │
│     getting this dismissed!            │
│                                         │
│  ┌───────────────────────────────────┐ │
│  │  Want help contesting?            │ │
│  │                                   │ │
│  │  [Download Contest Letter - $3]   │ │
│  │  Pre-filled with best arguments   │ │
│  │                                   │ │
│  │  [We'll Submit For You - $5]      │ │
│  │  We handle everything             │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

---

## Paid Tier 1: $3 Letter Download

**What user gets:**
- Pre-filled PDF letter addressed to Chicago DOAH
- Includes their ticket number, violation details
- Uses the #1 most successful dismissal reason from FOIA data
- Proper legal formatting
- Mailing instructions + deadline calculator
- Envelope addressing template

**Letter Template Example:**

```
Department of Administrative Hearings
City of Chicago
400 W. Superior St., 3rd Floor
Chicago, IL 60654

Re: Notice of Contest - Ticket #[TICKET_NUMBER]
    Violation Code: [VIOLATION_CODE]
    Citation Date: [DATE]

Dear Hearing Officer,

I am writing to formally contest the above-referenced parking
violation on the following grounds:

[BEST_DISMISSAL_REASON - e.g., "The violation is factually
inconsistent with the photographic evidence and citation details."]

Specifically:
• [AUTO-GENERATED ARGUMENT BASED ON VIOLATION TYPE]
• [SUPPORTING POINT FROM FOIA DATA]
• [LEGAL PRECEDENT IF APPLICABLE]

Based on historical data, this violation type (Code [CODE]) has
a 75.2% dismissal rate when contested by mail using this argument.

I respectfully request that you find me Not Liable for this violation.

Sincerely,
[USER_NAME]
[ADDRESS]
[PHONE]
```

**Payment Flow:**
1. User clicks "Download Letter - $3"
2. Stripe checkout
3. Generate PDF server-side
4. Email PDF + download link
5. Track in database: `contest_letters` table

---

## Paid Tier 2: $5 Full Submission

**What user gets:**
- We handle the entire submission
- Letter printed and mailed (if using Lob) OR
- Admin submits via Chicago website (if manual)
- Email confirmation + tracking
- Follow-up on outcome

**Option A: Lob API (Automated)**

**Pros:**
- Fully automated
- 1-2 day delivery
- Tracking number
- Professional printing

**Cons:**
- Costs ~$0.75 per letter (lower margin)
- Need Lob account

**Option B: Admin Queue (Manual)**

**Pros:**
- Higher margin ($5 revenue, minimal costs)
- More control over quality
- Can submit electronically via Chicago website
- Easier to start

**Cons:**
- Requires manual work
- Harder to scale

**Admin Panel View:**

```
┌─────────────────────────────────────────────────┐
│  📮 Contest Submissions Queue                   │
│                                                 │
│  [Pending: 12]  [Submitted: 45]  [Completed: 8]│
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ Ticket: 70234567  |  User: John Smith    │ │
│  │ Violation: 0976160B (Expired Plate)      │ │
│  │ Amount: $60  |  Ordered: 2 hours ago     │ │
│  │                                           │ │
│  │ [View Letter] [Mark as Submitted]        │ │
│  └───────────────────────────────────────────┘ │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │ Ticket: 70234568  |  User: Jane Doe      │ │
│  │ Violation: 0964190A (Expired Meter)      │ │
│  │ Amount: $50  |  Ordered: 5 hours ago     │ │
│  │                                           │ │
│  │ [View Letter] [Mark as Submitted]        │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

---

## Database Schema

### New Tables Needed:

**`contest_submissions`**
```sql
CREATE TABLE contest_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),

  -- Ticket details
  ticket_number TEXT NOT NULL,
  violation_code TEXT NOT NULL,
  violation_description TEXT,
  ticket_amount DECIMAL(10,2),
  citation_date DATE,

  -- User info
  user_name TEXT,
  user_address TEXT,
  user_phone TEXT,
  user_email TEXT,

  -- Service level
  service_type TEXT CHECK (service_type IN ('letter_download', 'full_submission')),

  -- FOIA insights used
  win_rate DECIMAL(5,2),
  dismissal_reason TEXT,
  recommended_method TEXT,

  -- Payment
  stripe_payment_intent_id TEXT,
  amount_paid DECIMAL(10,2),

  -- Letter generation
  letter_pdf_path TEXT,

  -- Submission tracking (for $5 tier)
  submission_status TEXT CHECK (submission_status IN (
    'pending', 'submitted', 'hearing_scheduled', 'dismissed', 'liable'
  )),
  submitted_at TIMESTAMP WITH TIME ZONE,
  submitted_by UUID REFERENCES auth.users(id), -- admin who submitted

  -- Lob tracking (if using Lob)
  lob_letter_id TEXT,
  lob_tracking_url TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

---

## Tech Stack

**Free Tool:**
- Next.js page: `/pages/contest-ticket.tsx`
- Component: `/components/TicketUploader.tsx`
- OCR: Tesseract.js (client-side) or Google Vision API (server-side)
- Existing: FOIATicketInsights component (already built!)

**$3 Letter:**
- PDF generation: `pdfkit` or `react-pdf`
- Template: `/templates/contest-letter-template.tsx`
- Payment: Stripe Checkout
- Storage: Supabase Storage for PDFs

**$5 Submission:**
- Option A: Lob API integration
- Option B: Admin queue page `/pages/admin/contest-submissions.tsx`
- Email: Resend (already set up)

---

## Viral Growth Mechanics

**Shareability:**
- "I just saved $60! My ticket has a 75% chance of dismissal 🎯"
- Social share buttons after analysis
- Referral program: "Share and get 1 free letter"

**SEO:**
- Blog posts: "How to Contest a [Violation Type] in Chicago"
- Landing pages per violation code
- Schema markup for rich snippets

**Content Marketing:**
- TikTok/Instagram: "I analyzed 1.2M parking tickets..."
- YouTube: "The #1 reason Chicago dismisses parking tickets"
- Reddit: r/chicago - "Free tool to check your ticket"

---

## MVP Scope (What to Build First)

**Week 1: Free Tool**
- [ ] Consumer-facing upload page
- [ ] Manual ticket entry (skip OCR for now)
- [ ] Show FOIA insights (already have component!)
- [ ] CTA for paid options (not yet functional)

**Week 2: $3 Letter**
- [ ] Letter template
- [ ] PDF generation
- [ ] Stripe payment
- [ ] Email delivery

**Week 3: $5 Submission (Manual)**
- [ ] Admin queue
- [ ] Submission tracking
- [ ] Email notifications

**Week 4: Scale & Optimize**
- [ ] Add OCR for ticket upload
- [ ] Optimize letter generation
- [ ] Add Lob integration (optional)
- [ ] Marketing launch

---

## Pricing Strategy

**Free Tier:**
- Unlimited ticket analysis
- See win rates and dismissal reasons
- Goal: Viral growth

**$3 Tier:**
- High margin (99% profit)
- Self-service
- Scales infinitely

**$5 Tier:**
- Medium margin (~$4 profit with manual, ~$3.50 with Lob)
- Better conversion (less work for user)
- Upsell opportunity

**Future Tiers:**
- $10: We represent you at hearing (via Zoom)
- $20/month: Protection subscription (existing product)

---

## Success Metrics

**Free Tool:**
- Traffic: 10,000 visitors/month
- Analysis completions: 5,000/month
- Viral coefficient: 1.2 (each user brings 1.2 more)

**Paid Conversion:**
- 10% download letter ($3) = 500 × $3 = $1,500/month
- 5% full submission ($5) = 250 × $5 = $1,250/month
- **Total: $2,750/month from contest tool**

**Protection Upsell:**
- 2% convert to Protection ($20/month) = 100 subscribers
- **Recurring: $2,000/month**

**Combined: $4,750/month from this feature**

---

## Questions to Answer:

1. **OCR now or later?** (I'd say later - manual entry MVP)
2. **Lob or manual submission?** (I'd say manual to start)
3. **Allow anonymous or require signup?** (Allow anonymous for virality)
4. **Letter template tone?** (Professional legal vs. friendly)
5. **Refund policy?** (If ticket isn't dismissed, refund $5?)

---

## Next Steps:

Ready to build this? I recommend:

1. **Start with the consumer-facing upload page** (1-2 hours)
2. **Hook up existing FOIA component** (30 min)
3. **Add "Coming Soon" buttons for paid tiers** (15 min)
4. **Test with real users** to validate demand
5. **Then build letter generation** once we have proof of concept

Want me to start building the free tool first?
