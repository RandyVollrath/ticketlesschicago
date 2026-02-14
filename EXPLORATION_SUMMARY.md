# TICKET CONTESTING SYSTEM - EXPLORATION SUMMARY

## What Was Discovered

A comprehensive ticket contesting system built into Ticketless Chicago that automates the defense and mailing of parking ticket contest letters. The system is production-ready and handling real Chicago parking violations.

---

## Generated Documentation

### 1. TICKET_CONTESTING_COMPLETE_ANALYSIS.md (810 lines)
**Complete technical deep-dive covering:**
- Letter generation architecture (AI + templates)
- Contest kit system (15+ violation types with FOIA-based win rates)
- City sticker violation handling (70% win rate - second highest!)
- Evidence collection flow (email forwarding system)
- Letter mailing system (Lob.com integration)
- Approval workflows (user approval + autopilot)
- Violation categorization and weather defense logic
- Database schema for all relevant tables
- Cron job execution details
- Full architecture diagrams

**Key Takeaway:** City sticker violations (code 9-100-010) have a 70% historical win rate and the system automatically sends customized evidence request emails asking for purchase receipts, sticker photos, and residency documentation.

---

### 2. CITY_STICKER_QUICK_REFERENCE.md (213 lines)
**Quick lookup guide specific to city sticker violations:**
- Violation code, fine amount, win rate
- Key file locations with line numbers
- Winning defenses ranked by success rate (85% for recently purchased, 80% for non-resident)
- Evidence collection strategy with impact scores
- Database table schemas
- Debugging checklist
- Revenue/impact analysis

**Key Takeaway:** Non-resident status alone gets 80% dismissal rate. Purchase receipts get 85%. The system sends emails asking the right questions to gather this evidence.

---

### 3. CITY_STICKER_CODE_REFERENCE.md (241 lines)
**Code snippets and exact locations:**
- Contest kit definitions
- Letter template (exact text sent to city)
- Evidence guidance system questions
- Email forwarding webhook details
- Database migration SQL
- Mailing system process
- Violation code mappings
- Approval workflow
- Kill switch mechanism
- Status flow diagrams
- Quick lookup table with all file locations

**Key Takeaway:** The system is modular - to modify city sticker handling, you only need to edit `/lib/contest-kits/city-sticker.ts` and `/lib/contest-kits/evidence-guidance.ts`.

---

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    TICKET DETECTION                             │
│  Portal scraper finds Chicago parking violations for users       │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│               VIOLATION CLASSIFICATION                           │
│  Maps ticket to violation code (9-100-010 = city sticker)        │
│  Retrieves contest kit with 70% historical win rate             │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│             EVIDENCE COLLECTION                                  │
│  Email forwarding system collects:                              │
│  - Purchase receipts (email auto-forwarding)                    │
│  - Sticker photos (manual upload)                               │
│  - Registration documents (manual upload)                       │
│  - Police reports (manual upload for theft claims)              │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              LETTER GENERATION                                   │
│  Two paths:                                                      │
│  1. AI-powered (Claude API) - integrates contest kit + evidence │
│  2. Template-based - fills placeholders automatically            │
│                                                                 │
│  For city sticker:                                              │
│  - Primary: "Valid Sticker Was Displayed" (75% win rate)        │
│  - Secondary: "Non-Chicago Resident" (80% win rate)             │
│  - Situational: "Recently Purchased", "Stolen", "Temp Stay"     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              APPROVAL WORKFLOW (OPTIONAL)                        │
│  If "Require Approval" enabled:                                 │
│  - Email to user with letter preview                            │
│  - User clicks "Approve & Mail" or "Skip"                       │
│  - 7-day JWT token expiry for security                          │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              MAILING (AUTOPILOT CRON)                            │
│  Scheduled job runs periodically:                               │
│  1. Gets user profile (mailing address)                         │
│  2. Embeds evidence images in letter                            │
│  3. Sends via Lob.com (physical mail service)                   │
│  4. Generates PDF + tracking number                             │
│  5. Updates database statuses                                   │
│  6. Sends user notification email                               │
│  7. Queues FOIA request for evidence packet                     │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│            TRACKING & OUTCOMES                                   │
│  PDF archives, delivery confirmations, outcome recording        │
│  Feeds back into system for win rate refinement                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## City Sticker Violations - Key Stats

| Metric | Value |
|--------|-------|
| Violation Code | 9-100-010 |
| Fine Amount | $120 |
| Win Rate (FOIA Data) | 70% |
| Category | Sticker |
| Contest Deadline | 21 days |
| Non-Resident Win Rate | 80% |
| Recent Purchase Win Rate | 85% |
| Sticker Display Win Rate | 75% |

---

## Evidence Collection Strategy

### Most Impactful Evidence (in order):

1. **Purchase Receipt** - Shows you bought sticker before ticket
   - Impact Score: 0.45 (45% increase to win probability)
   - Sources: City Clerk email, payment statement

2. **Sticker Photo** - Shows valid sticker on windshield
   - Impact Score: 0.35
   - Requirements: Lower-left corner, expiration visible

3. **Non-Resident Proof** - Visitor/out-of-state registration
   - Impact Score: 0.35
   - Sources: IL SOS registration, out-of-city utility bill

4. **Police Report** - For stolen sticker claims
   - Impact Score: 0.40 (highest impact!)
   - Requirement: CPD Report with RD number

5. **Bill of Sale** - For recently purchased vehicles
   - Impact Score: 0.25
   - Window: 30-day grace period from purchase

---

## Email Forwarding System

Users can automatically forward utility bills (ComEd, Peoples Gas, Xfinity) to a unique forwarding email. The system:

1. Receives emails via webhook
2. Uses Claude API to extract structured data (name, address, etc.)
3. Stores receipts in `city_sticker_receipts` table
4. Makes evidence available for letter generation

**Result:** Automatic proof-of-residency collection without user effort.

---

## Contest Kits Registry

The system has **15+ violation types**, each with:
- Violation code (e.g., 9-100-010)
- Historical win rate from FOIA court data (2023-2024)
- Primary, secondary, and fallback arguments
- Required, recommended, and optional evidence
- Category (parking, equipment, zone, sticker, camera)
- Weather defense relevance
- Quick tips and common pitfalls

**For City Sticker specifically:**
- 70% base win rate
- 3 core arguments
- 4 evidence request questions
- Non-resident exemption explanation
- Grace period for new vehicles

---

## Letter Delivery

Letters are:
1. Generated and formatted as HTML
2. Evidence images embedded in PDF
3. Sent via **Lob.com** (physical mail service)
4. Addressed to:
   ```
   City of Chicago
   Department of Finance
   Parking Ticket Contests
   P.O. Box 88292
   Chicago, IL 60680-1292
   ```
5. Delivery confirmed and tracked
6. PDF archived for user records

---

## Database Tables

### Key Tables for City Sticker:

**detected_tickets**
- Stores ticket data from portal scraper
- `violation_code: '9-100-010'` for city sticker tickets
- `user_evidence: JSON` array of attachment URLs
- `status: 'found' → 'letter_generated' → 'mailed'`

**contest_letters**
- Generated letters with full content
- `defense_type: 'sticker_purchased'`
- `status: 'draft' → 'pending_approval' → 'approved' → 'sent'`
- Lob.com tracking number and PDF URL

**city_sticker_receipts**
- Forwarded sticker purchase emails
- Stores sender, subject, storage path
- RLS policy ensures users only see own receipts

**ticket_audit_log**
- Comprehensive audit trail
- Logs all actions (letter_generated, letter_mailed, etc.)
- Includes defense type and timestamps

---

## Automation Features

### Autopilot Cron Jobs:

1. **autopilot-generate-letters.ts**
   - Finds new detected tickets
   - Generates contest letters
   - Sends approval emails if needed
   - Checks for weather defenses
   - Includes GPS parking evidence from mobile app

2. **autopilot-mail-letters.ts**
   - Fetches approved letters ready to mail
   - Gets user profile (mailing address)
   - Embeds evidence images
   - Sends via Lob.com
   - Updates statuses
   - Queues FOIA requests
   - Notifies users

### Kill Switches:

System checks admin settings for:
- `kill_all_mailing` - Pause all letter generation
- `maintenance_mode` - Pause with custom message
- Prevents accidental letter generation during issues

---

## Integration Points

### Frontend
- `/components/EmailForwardingSetup.tsx` - Setup UI
- `/pages/tickets/[id].tsx` - Ticket detail + contest button
- `/pages/registration-evidence.tsx` - Evidence upload

### APIs
- `POST /pages/api/contest/generate-letter.ts` - Letter generation
- `POST /pages/api/email/forward.ts` - Email webhook
- `POST /pages/api/cron/autopilot-generate-letters.ts` - Cron job
- `POST /pages/api/cron/autopilot-mail-letters.ts` - Mailing cron

### External Services
- **Claude API** (Anthropic) - AI-powered letter generation
- **Lob.com** - Physical letter printing & mailing
- **Resend Email** - User notifications
- **Supabase** - Database & RLS policies
- **Vercel** - Cron job scheduling

---

## Files to Know

| File | Purpose |
|------|---------|
| `/lib/contest-kits/city-sticker.ts` | City sticker kit definition |
| `/lib/contest-kits/index.ts` | Kit registry + lookups |
| `/lib/contest-kits/evidence-guidance.ts` | Evidence request templates |
| `/lib/contest-kits/types.ts` | Type definitions |
| `/pages/api/contest/generate-letter.ts` | Main letter generation endpoint |
| `/pages/api/cron/autopilot-generate-letters.ts` | Batch letter generation |
| `/pages/api/cron/autopilot-mail-letters.ts` | Mailing execution |
| `/pages/api/email/forward.ts` | Email webhook processor |
| `/components/EmailForwardingSetup.tsx` | Setup UI |
| `/supabase/migrations/20260207113000...sql` | Receipt table schema |

---

## Key Learnings

1. **High Win Rates for City Sticker:**
   - 85% with purchase receipt
   - 80% non-resident status
   - 75% sticker display proof
   - 70% overall base rate

2. **Smart Evidence Collection:**
   - Email forwarding for automatic receipts
   - Customized questions based on violation type
   - Impact scoring for evidence types
   - Evidence checklists generated automatically

3. **Approval Workflow:**
   - Optional approval required per user settings
   - 7-day JWT tokens for security
   - Prevent accidental/inappropriate mailing

4. **Audit Trail:**
   - Comprehensive logging of all actions
   - Defense types recorded
   - Timestamps for all events
   - User performing action tracked

5. **Modular Contest Kits:**
   - 15+ violation types supported
   - Each with win rate from FOIA data
   - Customizable arguments per violation
   - Evidence requirements per kit

---

## Production Status

- System is **fully operational** and handling real tickets
- **70% win rate** documented from court data for city sticker violations
- **Automated mailing** via Lob.com with tracking
- **Email forwarding** working with Claude API extraction
- **Audit logging** comprehensive and complete
- **RLS policies** protecting user data
- **Kill switches** protecting against accidents

---

## Next Steps for Development

1. Monitor FOIA outcomes to refine win rate estimates
2. Add more evidence types (dashcam footage, witness statements)
3. Integrate with Chicago tribunal hearing scheduling
4. Add appeal letter generation for denied cases
5. Expand to other Chicago violation types
6. Add mobile app GPS evidence to letter attachments

---

## Questions Answered

✅ How contest letters are created - AI + template-based system with Claude API
✅ City sticker handling - 70% win rate, 3 argument templates, 5 evidence types
✅ Autopilot mail system - Lob.com integration with proof embedding
✅ Evidence gathering flow - Email forwarding + manual upload + mobile GPS
✅ Violation categorization - 15+ types with codes and win rates
✅ Email forwarding setup - Gmail filters for automatic bill forwarding
✅ Receipts collection - city_sticker_receipts table with RLS
✅ Database schema - Complete with ticket, letter, receipt, and audit tables

---

**Documentation Created:** 3 comprehensive markdown files (1,264 lines total)
**Repository Location:** /home/randy-vollrath/ticketless-chicago/
**Files Generated:**
1. TICKET_CONTESTING_COMPLETE_ANALYSIS.md (810 lines)
2. CITY_STICKER_QUICK_REFERENCE.md (213 lines) 
3. CITY_STICKER_CODE_REFERENCE.md (241 lines)

