# CITY STICKER VIOLATIONS - QUICK REFERENCE GUIDE

## Overview
- **Violation Code**: 9-100-010
- **Fine Amount**: $120
- **Win Rate**: 70% (second highest after Expired Plates at 75%)
- **Category**: Sticker violations
- **Contest Deadline**: 21 days from ticket date

---

## KEY FILE LOCATIONS

### Contest Kit (Everything about City Sticker Violations)
📍 `/home/randy-vollrath/ticketless-chicago/lib/contest-kits/city-sticker.ts`
- Contains 3 argument templates
- Evidence requirements
- Eligibility rules
- Win rate information

### Evidence Guidance System
📍 `/home/randy-vollrath/ticketless-chicago/lib/contest-kits/evidence-guidance.ts` (lines 85-127)
- Customized evidence request questions for city sticker
- "Why it matters" explanations
- Good example responses
- Quick tips and pitfalls

### Letter Generation
📍 `/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-generate-letters.ts` (lines 176-184)
- City sticker template: `no_city_sticker`
- Defense type: `sticker_purchased`
- Auto-fill variables

### Email Forwarding Setup (For Receipts)
📍 `/home/randy-vollrath/ticketless-chicago/components/EmailForwardingSetup.tsx`
- ComEd, Peoples Gas, Xfinity instructions
- User-facing setup flow

### Mailing/Delivery System
📍 `/home/randy-vollrath/ticketless-chicago/pages/api/cron/autopilot-mail-letters.ts`
- Sends letters via Lob.com
- Embeds evidence images
- Sends user notification
- Queues FOIA requests

### Database Migrations
📍 `/home/randy-vollrath/ticketless-chicago/supabase/migrations/20260207113000_create_city_sticker_receipts.sql`
- City sticker receipt storage
- RLS policies for user privacy

---

## WINNING DEFENSES (Ranked by Success Rate)

| Defense | Win Rate | Required Evidence |
|---------|----------|-------------------|
| Recently Purchased Vehicle | 85% | Bill of sale, purchase date within 30 days |
| Non-Resident Status | 80% | Out-of-city registration, proof of residence elsewhere |
| Valid Sticker Was Displayed | 75% | Clear windshield photo showing sticker + expiration |
| Sticker Stolen | 70% | CPD police report with RD number |
| Generic Contest | 50% | N/A |

---

## EVIDENCE COLLECTION STRATEGY

### Highest Impact Evidence (in order):
1. **Purchase Receipt** (Impact: 0.45)
   - City Clerk online confirmation
   - City of Chicago payment statement
   - Credit card showing "City of Chicago" charge
   - Proves you purchased BEFORE the ticket

2. **Sticker Photo** (Impact: 0.35)
   - Clear windshield photo showing sticker
   - Expiration date visible
   - Taken from outside vehicle
   - Can be taken after ticket for re-contest

3. **Non-Resident Proof** (Impact: 0.35)
   - Out-of-city vehicle registration (IL SOS)
   - Lease/utility bill at different address
   - Visitor status documentation

4. **Police Report** (Impact: 0.40)
   - For stolen sticker claims
   - CPD Report - Records Division number
   - File ASAP - dated police report strengthens case

5. **Registration Documents** (Impact: 0.20)
   - IL Secretary of State registration
   - Vehicle ownership documents
   - Address verification

---

## EVIDENCE REQUEST EMAIL FLOW

### System sends customized email asking:

1. "Did you purchase your city sticker BEFORE the ticket date?"
   - Wants: Confirmation email, receipt, credit card statement
   - Impact: 0.45 (strongest!)

2. "Are you registered outside Chicago city limits?"
   - Wants: Out-of-city registration proof
   - Impact: 0.40 (second strongest!)

3. "Did you recently purchase this vehicle?"
   - Wants: Bill of sale with date
   - Impact: 0.30 (grace period defense)

4. "Was your sticker purchased but not yet displayed?"
   - Wants: Explanation + photos
   - Impact: 0.20

---

## ARGUMENT TEMPLATES GENERATED

### Primary Argument: "Valid Sticker Was Displayed" (75% win rate)
Used when user has proof of valid sticker or photo showing display

Key points:
- Sticker was properly affixed to lower-left windshield
- Officer may not have seen it (glare, weather, angle, wrong plate)
- Attached photographic evidence
- Request dismissal

### Secondary Argument: "Non-Chicago Resident" (80% win rate)
Used when user is not a Chicago resident

Key points:
- Vehicle registered outside Chicago city limits
- City sticker only required for residents/regular users
- Vehicle principally kept elsewhere
- Temporary visit exemption
- Request dismissal

### Fallback Arguments:
- "Sticker Was Stolen" (requires police report)
- "Recently Purchased" (requires bill of sale within 30 days)
- "Sticker In Transit" (required purchase receipt)

---

## DATABASE TABLES

### city_sticker_receipts
```
Stores forwarded sticker purchase receipts/emails
- user_id: Which user
- sender_email: Which company (City Clerk, payment processor)
- email_subject: Original subject line
- storage_path: File location
- forwarded_at: When email arrived
```

### detected_tickets
```
Main ticket record
- violation_type: 'no_city_sticker'
- violation_code: '9-100-010'
- violation_date: When ticket was issued
- user_evidence: JSON array of evidence URLs
- status: 'found' → 'letter_generated' → 'mailed'
```

### contest_letters
```
Generated contest letter
- ticket_id: Links to detected_tickets
- letter_content: Full formatted letter
- defense_type: 'sticker_purchased'
- status: 'draft' → 'pending_approval' → 'approved' → 'sent'
```

---

## QUICK DEBUGGING CHECKLIST

If city sticker letter generation not working:

- [ ] Is violation_code set to '9-100-010'?
- [ ] Is violation_type 'no_city_sticker'?
- [ ] Does city-sticker.ts exist and export cityStickerKit?
- [ ] Is kit registered in index.ts CONTEST_KITS?
- [ ] Is evidence_guidance.ts including 'no_city_sticker' entry?
- [ ] Are email forwarding emails being captured?
- [ ] Are receipts being stored in city_sticker_receipts table?
- [ ] Is Lob.com service configured?

---

## REVENUE/IMPACT

- **Fine Amount**: $120 per violation
- **Average Contest Cases**: ~5-10 per month
- **Success Rate**: 70%
- **Potential Monthly Impact**: $420-840 in dismissed tickets
- **User Retention**: High (city sticker is recurring annual cost)

---

## KNOWN EDGE CASES

1. **Non-Resident Exception**
   - Visitors automatically exempt
   - Must prove out-of-city registration
   - This alone can get 80% dismissal rate

2. **30-Day Grace Period**
   - New vehicle owners not required immediately
   - Bill of sale date is key evidence
   - This can get 85% dismissal rate

3. **Sticker Theft**
   - Requires CPD police report
   - RD number must be included
   - Can get 70% dismissal rate

4. **Display Issues**
   - Sticker must be in lower-left corner
   - Glare/weather can obscure from officer
   - Photos are strongest evidence

---

## CONTACT/SEND ADDRESS

All contest letters sent to:
```
City of Chicago
Department of Finance
Parking Ticket Contests
P.O. Box 88292
Chicago, IL 60680-1292
```

---

## RELATED DOCUMENTS

- Full analysis: `/TICKET_CONTESTING_COMPLETE_ANALYSIS.md`
- Contest kits: `/lib/contest-kits/`
- Evidence guidance: `/lib/contest-kits/evidence-guidance.ts`
